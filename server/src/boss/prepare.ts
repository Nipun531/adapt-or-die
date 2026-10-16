/**
 * BOSS PREPARATION (runs at the start of each round, before combat).
 *
 * history (rounds 1..N) → feature builder → predictor (model or baseline) → decision policy
 * → rules validation (applyPlan via equipment.ts) → persisted boss_decisions row + progression ledger.
 *
 * The boss sees only history: the player's LAST OBSERVED build (attributes + equipment from round N,
 * plus automatic level-up increases awarded after it). It never sees the player's current-round changes.
 */
import { getItem } from '../game/catalog.js';
import { snapshotOf } from '../game/derive.js';
import { initialCombatant } from '../game/progression.js';
import { deriveSeed } from '../game/rng.js';
import type { CombatantState } from '../game/types.js';
import type { Db } from '../db/pool.js';
import { baselineProbability, buildFeatures, rangedFeasibility } from '../ml/features.js';
import { predictPlayerStyle, type Prediction } from '../ml/predictor.js';
import { loadCompletedRounds } from '../services/history.js';
import { loadCombatant, logProgression, saveCombatant } from '../services/runs.js';
import type { Weakness } from './analysis.js';
import { applyPlan, choosePlan, type Archetype } from './policy.js';

/** Which derived metric each weakness is most directly addressed by (used only for explanation). */
const WEAKNESS_METRICS: Record<string, ('effDex' | 'netDef' | 'netAtk' | 'maxHp')[]> = {
  ranged_pressure: ['effDex', 'maxHp', 'netDef'],
  pierce_exposure: ['effDex', 'maxHp'],
  heavy_melee_pressure: ['netDef', 'maxHp', 'effDex'],
  dex_deficit: ['effDex'],
  low_defense: ['netDef'],
  low_damage_output: ['netAtk', 'effDex'],
  outmatched: ['netAtk', 'netDef', 'effDex', 'maxHp'],
  narrow_loss: ['netAtk', 'netDef', 'effDex', 'maxHp'],
};

export interface BossPrepResult {
  decisionId: number;
  boss: CombatantState;
  prediction: Prediction;
}

export async function bossPrepare(db: Db, runId: number, runSeed: string, roundNumber: number): Promise<BossPrepResult> {
  const history = await loadCompletedRounds(db, runId, roundNumber - 1);
  const records = history.map((h) => h.record);
  const features = records.length ? buildFeatures(records) : null;
  // Round 1: no history — the boss knows the starting state (base stats, 2 unspent points, 0 gold, no items). It cannot
  // see how the player spends those points (current-round preparation), just as it never sees later-round prep; the
  // policy therefore considers every way they could spend them (reachable scenarios).
  const observed = records.length ? records[records.length - 1].playerPost : initialCombatant('player');
  const prediction = await predictPlayerStyle(db, features, baselineProbability(records), rangedFeasibility(observed));

  const before = await loadCombatant(db, runId, 'boss', true);
  const prev = roundNumber > 1
    ? (await db.query(`SELECT selected->'plan'->>'archetype' AS a FROM boss_decisions WHERE run_id = $1 AND for_round_number = $2`, [runId, roundNumber - 1])).rows[0]?.a ?? null
    : null;
  const policy = choosePlan({
    boss: before,
    observedPlayer: observed,
    pRanged: prediction.probabilityRanged,
    seed: String(deriveSeed(runSeed, `boss:${roundNumber}`)),
    previousArchetype: prev as Archetype | null,
  });
  const plan = policy.selected;
  const after = applyPlan(before, plan); // re-validated by the rules (throws on anything illegal)

  // Ledger: one entry per concrete action, mirroring what a player would do.
  const actions: { kind: string; detail: unknown }[] = [];
  for (const [stat, points] of Object.entries(plan.allocation)) if (points) actions.push({ kind: 'stat_allocation', detail: { stat, points } });
  for (const itemId of plan.purchases) actions.push({ kind: 'purchase', detail: { itemId, cost: getItem(itemId)!.cost } });
  const loadoutChanged = JSON.stringify(before.loadout) !== JSON.stringify(after.loadout);
  if (loadoutChanged) actions.push({ kind: 'equip', detail: { loadout: after.loadout } });
  for (const a of actions) {
    await logProgression(db, { runId, side: 'boss', kind: a.kind, actor: 'boss_policy', payload: { ...(a.detail as object), forRoundNumber: roundNumber }, stateAfter: after });
  }
  await saveCombatant(db, runId, after);

  // Evidence: last analysis weaknesses + how the chosen plan moves the relevant metrics.
  const lastAnalysis = history.length
    ? (await db.query('SELECT analysis FROM boss_analyses WHERE round_id = $1', [history[history.length - 1].id])).rows[0]?.analysis
    : null;
  const weaknesses: Weakness[] = lastAnalysis?.weaknesses ?? [];
  const d0 = snapshotOf(before).derived;
  const d1 = snapshotOf(after).derived;
  const deltas = {
    effDex: d1.effDex - d0.effDex, netDef: d1.netDef - d0.netDef, netAtk: d1.netAtk - d0.netAtk, maxHp: d1.maxHp - d0.maxHp,
  };
  const addressed = weaknesses.map((w) => {
    const metrics = WEAKNESS_METRICS[w.code] ?? [];
    const moved = metrics.filter((m) => deltas[m] > 0).map((m) => `${m} +${deltas[m].toFixed(2)}`);
    return { code: w.code, evidence: w.evidence, addressedBy: moved, addressed: moved.length > 0 };
  });

  const evidence = {
    sourceRound: records.length ? records[records.length - 1].roundNumber : null,
    weaknesses: addressed,
    observedPlayer: {
      level: observed.level, stats: observed.stats,
      loadout: [observed.loadout.hand1, observed.loadout.hand2, observed.loadout.armour].filter(Boolean).map((id) => getItem(id!)!.name),
    },
    scenarios: policy.scenarios,
    derivedBefore: d0, derivedAfter: d1, deltas,
    constraints: { goldAvailable: before.gold, statPointsAvailable: before.statPoints, inventory: before.inventory },
  };
  const ins = await db.query(
    `INSERT INTO boss_decisions (run_id, for_round_number, predictor, evidence, options, selected, actions, gold_spent, state_before, state_after)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [runId, roundNumber, JSON.stringify(prediction), JSON.stringify(evidence),
      JSON.stringify({ candidatesEvaluated: policy.candidatesEvaluated, current: policy.current, alternatives: policy.alternatives }),
      JSON.stringify({ plan, rationale: policy.rationale, policyVersion: policy.version, band: policy.band ?? null, draw: policy.draw ?? null }), JSON.stringify(actions), plan.cost,
      JSON.stringify(before), JSON.stringify(after)],
  );
  return { decisionId: ins.rows[0].id, boss: after, prediction };
}
