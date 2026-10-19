/**
 * ROUND ORCHESTRATION — the authoritative round lifecycle.
 *
 * startRound:  lock run (prep phase) → round 1 only: player must have spent the initial stat points →
 *              boss prepares from history (round 1: spends its own initial points) → snapshot both fighters →
 *              create round row → run combat until finished or the player must choose → persist events.
 * submitChoice: resume a paused combat with the player's decision (engine 3.0.0: attack mode, Block/Dodge for an
 *              announced boss attack, or using a healing stim).
 * completeRound (internal): rewards + level-ups for both sides → post-states → boss analysis →
 *              append ML training example → close run if max rounds reached.
 * Everything for one request happens in ONE transaction, so a failure leaves no half-written round.
 */
import { analyzeRound } from '../boss/analysis.js';
import { bossPrepare } from '../boss/prepare.js';
import { bossChooser, bossDefense, bossStim } from '../boss/policy.js';
import { advanceCombat, startCombat, type AdvanceOptions, type Chooser, type CombatEvent, type CombatNote, type CombatState, type DefenseAction, type DefenseChooser, type StimChooser } from '../game/combat.js';
import { RULES_V2, RULES_V3, type RuleSet } from '../game/rules.js';
import { ENGINE_VERSION } from '../game/constants.js';
import { snapshotOf } from '../game/derive.js';
import { loadoutProblem, RuleError } from '../game/equipment.js';
import { applyRoundRewards } from '../game/progression.js';
import { deriveSeed } from '../game/rng.js';
import type { AttackMode, CombatantState, Side } from '../game/types.js';
import { withTransaction, type Db } from '../db/pool.js';
import { appendExample } from '../ml/examples.js';
import { loadEvents } from './history.js';
import { assertCurrentEngine, loadCombatant, lockRunForPrep, logProgression, NotFoundError, saveCombatant } from './runs.js';

const waitForHuman: Chooser = () => null;
const waitForHumanDefense: DefenseChooser = () => null;
const waitForHumanStim: StimChooser = () => null;

/** Combat rules of a run's engine (all continuable runs are the live engine; see assertCurrentEngine). */
export function rulesForEngine(engineVersion: string): RuleSet {
  return engineVersion.startsWith('3.') ? RULES_V3 : RULES_V2;
}

/** Player choosers for one round: the human (pause) unless a simulation passes its agent's choosers. */
export interface PlayerChoosers {
  /** Ranged+Melee attacks. Default: pause and wait for the human. */
  playerChooser?: Chooser;
  /** V3: Block/Dodge answers to the boss's attacks. Default: pause and wait for the human. */
  playerDefense?: DefenseChooser;
  /** V3: stim use before the player's action. Default: pause and wait for the human. */
  playerStim?: StimChooser;
}

function combatOptions(rules: RuleSet, p: PlayerChoosers): Omit<AdvanceOptions, 'provided'> {
  if (!rules.v3) return {};
  return {
    defense: { player: p.playerDefense ?? waitForHumanDefense, boss: bossDefense(rules) },
    stim: { player: p.playerStim ?? waitForHumanStim, boss: bossStim },
  };
}

export interface StartRoundOptions extends PlayerChoosers {
  /** Use an existing transaction (simulations); otherwise a new one is opened. */
  db?: Db;
}

export async function startRound(runId: number, opts: StartRoundOptions = {}): Promise<number> {
  const fn = async (c: Db) => {
    const run = await lockRunForPrep(c, runId);
    const last = await c.query('SELECT COALESCE(MAX(round_number), 0)::int AS n FROM rounds WHERE run_id = $1', [runId]);
    const roundNumber = last.rows[0].n + 1;
    if (roundNumber > run.max_rounds) throw new RuleError(`Run already played its ${run.max_rounds} rounds`);

    const player = await loadCombatant(c, runId, 'player', true);
    const problem = loadoutProblem(player.loadout, player.inventory);
    if (problem) throw new RuleError(`Player loadout is illegal: ${problem}`);
    // Engine 1.1.0: the initial stat points must be spent before round 1 (later rounds may carry points over).
    if (roundNumber === 1 && player.statPoints > 0) {
      throw new RuleError(`Allocate your ${player.statPoints} initial stat point(s) before round 1`);
    }

    const prep = await bossPrepare(c, runId, run.seed, roundNumber);
    // The boss policy always spends every available point; guard the round-1 invariant explicitly anyway.
    if (roundNumber === 1 && prep.boss.statPoints > 0) throw new Error('Boss entered round 1 with unallocated initial stat points');
    const seed = deriveSeed(run.seed, `round:${roundNumber}`);
    const pSnap = snapshotOf(player);
    const bSnap = snapshotOf(prep.boss);
    const rules = rulesForEngine(run.engine_version);
    const state = startCombat(pSnap, bSnap, seed, rules);

    const ins = await c.query(
      `INSERT INTO rounds (run_id, round_number, status, seed, engine_version, player_pre, boss_pre, player_snapshot, boss_snapshot, initiative)
       VALUES ($1,$2,'in_progress',$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [runId, roundNumber, seed, ENGINE_VERSION, JSON.stringify(player), JSON.stringify(prep.boss),
        JSON.stringify(pSnap), JSON.stringify(bSnap), JSON.stringify(state.initiative)],
    );
    const roundId = ins.rows[0].id as number;
    await c.query('UPDATE boss_decisions SET round_id = $1 WHERE id = $2', [roundId, prep.decisionId]);

    const res = advanceCombat(state, { player: opts.playerChooser ?? waitForHuman, boss: bossChooser }, combatOptions(rules, opts));
    await persistProgress(c, run, roundId, roundNumber, res.state, res.events, res.notes);
    return roundId;
  };
  return opts.db ? fn(opts.db) : withTransaction(fn);
}

/** The player's answer to a paused round (exactly one of mode / defense / stim, matching the pending decision). */
export interface PlayerAnswer { mode?: AttackMode; repeat?: boolean; defense?: DefenseAction; stim?: boolean }

export async function submitChoice(roundId: number, answer: PlayerAnswer | AttackMode, repeat = false): Promise<void> {
  const a: PlayerAnswer = typeof answer === 'string' ? { mode: answer, repeat } : answer;
  await withTransaction(async (c) => {
    const r = await c.query('SELECT * FROM rounds WHERE id = $1 FOR UPDATE', [roundId]);
    const round = r.rows[0];
    if (!round) throw new NotFoundError(`Round ${roundId} not found`);
    if (round.status !== 'in_progress' || !round.pending_choice) throw new RuleError('This round is not waiting for a choice');
    const run = (await c.query('SELECT * FROM runs WHERE id = $1 FOR UPDATE', [round.run_id])).rows[0];
    assertCurrentEngine(run); // a paused round of an older-engine run cannot resume under the live rules
    let res;
    try {
      const rules = rulesForEngine(run.engine_version);
      res = advanceCombat(round.combat_state as CombatState, { player: waitForHuman, boss: bossChooser }, {
        ...combatOptions(rules, {}),
        provided: { side: 'player', ...a },
      });
    } catch (e) {
      throw new RuleError((e as Error).message);
    }
    await persistProgress(c, run, roundId, round.round_number, res.state, res.events, res.notes);
  });
}

async function insertEvents(c: Db, roundId: number, events: CombatEvent[]) {
  const COLS = 19;
  const CHUNK = 300; // 300 × 19 params stays well under Postgres' 65535-parameter limit
  for (let i = 0; i < events.length; i += CHUNK) {
    const part = events.slice(i, i + CHUNK);
    const params: unknown[] = [];
    const rows = part.map((e, j) => {
      params.push(roundId, e.seq, e.turn, e.phase, e.attacker, e.defender, e.mode, e.weaponId, e.choiceSource,
        e.choiceReason ?? null, JSON.stringify(e.calc), e.damage, e.defenderHpBefore, e.defenderHpAfter, e.attackerHp,
        e.kind ?? null, e.parentSeq ?? null, e.defense ? JSON.stringify(e.defense) : null, e.stun ? JSON.stringify(e.stun) : null);
      return `(${Array.from({ length: COLS }, (_, k) => `$${j * COLS + k + 1}`).join(',')})`;
    });
    await c.query(
      `INSERT INTO combat_events (round_id, seq, turn, phase, attacker, defender, mode, weapon_id, choice_source, choice_reason,
         calc, damage, defender_hp_before, defender_hp_after, attacker_hp, kind, parent_seq, defense, stun) VALUES ${rows.join(',')}`,
      params,
    );
  }
}

async function persistProgress(c: Db, run: any, roundId: number, roundNumber: number, state: CombatState, events: CombatEvent[], notes: CombatNote[] = []) {
  await insertEvents(c, roundId, events);
  if (notes.length) {
    await c.query(`UPDATE rounds SET combat_notes = COALESCE(combat_notes, '[]'::jsonb) || $2::jsonb WHERE id = $1`, [roundId, JSON.stringify(notes)]);
  }
  if (state.winner) {
    await completeRound(c, run, roundId, roundNumber, state);
  } else {
    await c.query(
      `UPDATE rounds SET combat_state = $2, pending_choice = $3, attack_count = $4 WHERE id = $1`,
      [roundId, JSON.stringify(state), JSON.stringify(state.pending), state.seq],
    );
  }
}

async function completeRound(c: Db, run: any, roundId: number, roundNumber: number, state: CombatState) {
  const runId = run.id as number;
  const winner = state.winner as Side;
  const results: Record<Side, ReturnType<typeof applyRoundRewards>> = {} as any;
  for (const side of ['player', 'boss'] as Side[]) {
    const loaded = await loadCombatant(c, runId, side, true);
    // V3: stims used in the round are gone (their slots stay empty until a new stim is bought).
    const before: CombatantState = state.v3 && loaded.supplies ? { ...loaded, supplies: { ...loaded.supplies, stims: state.v3.stims[side] } } : loaded;
    const res = applyRoundRewards(before, winner === side);
    results[side] = res;
    await saveCombatant(c, runId, res.state);
    for (const entry of res.entries) {
      await logProgression(c, { runId, roundId, side, kind: entry.kind, actor: 'rules', payload: entry, stateAfter: null });
    }
  }
  const events = await loadEvents(c, roundId);
  const analysis = analyzeRound({
    roundNumber, winner, player: state.fighters.player, boss: state.fighters.boss, events,
    playerHpEnd: state.hp.player, bossHpEnd: state.hp.boss, initiative: state.initiative,
  });
  await c.query(
    `UPDATE rounds SET status='completed', winner=$2, player_hp_end=$3, boss_hp_end=$4, attack_count=$5,
       player_rewards=$6, boss_rewards=$7, player_post=$8, boss_post=$9, combat_state=NULL, pending_choice=NULL, completed_at=now(),
       end_reason=$10
     WHERE id=$1`,
    [roundId, winner, state.hp.player, state.hp.boss, state.seq,
      JSON.stringify(results.player.entries), JSON.stringify(results.boss.entries),
      JSON.stringify(results.player.state), JSON.stringify(results.boss.state), state.endReason ?? null],
  );
  await c.query('INSERT INTO boss_analyses (run_id, round_id, analysis) VALUES ($1,$2,$3)', [runId, roundId, JSON.stringify(analysis)]);
  await appendExample(c, runId, roundNumber);
  if (roundNumber >= run.max_rounds) {
    await c.query(`UPDATE runs SET status='completed', end_reason='max_rounds', ended_at=now(), updated_at=now() WHERE id=$1`, [runId]);
  } else {
    await c.query('UPDATE runs SET updated_at=now() WHERE id=$1', [runId]);
  }
}

export async function getRoundDetail(db: Db, roundId: number) {
  const r = await db.query('SELECT * FROM rounds WHERE id = $1', [roundId]);
  const round = r.rows[0];
  if (!round) throw new NotFoundError(`Round ${roundId} not found`);
  const events = await loadEvents(db, roundId);
  const analysis = (await db.query('SELECT analysis FROM boss_analyses WHERE round_id = $1', [roundId])).rows[0]?.analysis ?? null;
  const decision = (await db.query('SELECT * FROM boss_decisions WHERE run_id = $1 AND for_round_number = $2', [round.run_id, round.round_number])).rows[0] ?? null;
  const progression = (await db.query('SELECT * FROM progression_events WHERE round_id = $1 ORDER BY id', [roundId])).rows;
  const { combat_state: _cs, ...rest } = round;
  const cs = _cs as CombatState | null;
  return {
    round: {
      ...rest,
      hp: cs ? cs.hp : null,
      autoMode: cs ? cs.autoMode : null,
      // V3 live meters while the round is in progress (public information).
      stun: cs?.v3 ? cs.v3.stun : null,
      stims: cs?.v3 ? cs.v3.stims : null,
    },
    events, notes: (round.combat_notes ?? []) as CombatNote[], analysis, decision, progression,
  };
}
