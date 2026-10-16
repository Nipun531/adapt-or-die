/**
 * Boss PRE-ROUND DECISION POLICY (constrained decision layer).
 *
 *   observed player build + P(player mostly ranged)  ──►  enumerate LEGAL plans  ──►  score  ──►  pick
 *
 * 1. Enumerate every legal plan: stat-point allocation × loadout reachable with owned items plus
 *    purchases the boss can afford (validated by the same rules as the player).
 * 2. Build two opponent scenarios from the player's LAST OBSERVED build (attributes + equipped items):
 *    "ranged" (player attacks with a bow/crossbow) and "melee". Missing weapons are assumed
 *    hypothetically (Bow / Sword) — the boss never sees the player's current-round changes.
 * 3. Cheap analytic pre-score (expected time-to-kill) for all plans, then Monte-Carlo verification of the
 *    top plans with the REAL combat engine (seeded → reproducible).
 * 4. Weighted score = p·winRate(ranged) + (1−p)·winRate(melee), where p comes from the ML model or the
 *    transparent baseline. So the prediction changes which plan is chosen.
 * 5. Among plans within SCORE_TOLERANCE of the best, prefer the cheapest (saves gold), then higher margin.
 * The policy only RETURNS a plan; prepare.ts applies it through equipment.ts (which re-validates).
 */
import { ITEMS, requireItem } from '../game/catalog.js';
import { openingShooters, runFullCombat, type Chooser } from '../game/combat.js';
import { deriveStats, snapshotOf } from '../game/derive.js';
import { allocateStat, equip, isLegalLoadout, purchase } from '../game/equipment.js';
import { bestMode, expectedAttackDamage } from '../game/expected.js';
import { dexBonusAttacks } from '../game/formulas.js';
import { deriveSeed } from '../game/rng.js';
import type { AttackMode, CombatantState, FighterSnapshot, Loadout, StatKey } from '../game/types.js';
import { STAT_KEYS } from '../game/types.js';

export const POLICY_CONFIG = {
  topK: 6,               // plans verified by Monte-Carlo
  fightsPerScenario: 16, // MC fights per scenario per plan
  scoreTolerance: 0.02,  // plans this close to best are "equivalent" → cheapest wins
};

export type Allocation = Partial<Record<StatKey, number>>;

export interface Plan {
  allocation: Allocation;
  purchases: string[];
  loadout: Loadout;
  cost: number;
}

export interface ScoredPlan extends Plan {
  analytic: { ranged: number; melee: number };
  winRate?: { ranged: number; melee: number };
  weighted: number;
  label: string;
}

export interface Scenario {
  kind: 'ranged' | 'melee';
  snapshot: FighterSnapshot;
  preferredMode: AttackMode;
  hypotheticalItems: string[];
}

export interface PolicyResult {
  selected: ScoredPlan;
  current: ScoredPlan;
  alternatives: ScoredPlan[];
  candidatesEvaluated: number;
  scenarios: { kind: string; loadout: Loadout; preferredMode: AttackMode; hypotheticalItems: string[] }[];
  rationale: string[];
}

/** All ways to spend exactly `points` across the 4 stats (capped for large point pools). */
export function allocationOptions(points: number): Allocation[] {
  if (points <= 0) return [{}];
  if (points > 4) {
    const dumps = STAT_KEYS.map((k) => ({ [k]: points }) as Allocation);
    return dumps;
  }
  const out: Allocation[] = [];
  const rec = (i: number, left: number, acc: Allocation) => {
    if (i === STAT_KEYS.length - 1) {
      out.push(left > 0 ? { ...acc, [STAT_KEYS[i]]: left } : { ...acc });
      return;
    }
    for (let n = 0; n <= left; n++) rec(i + 1, left - n, n > 0 ? { ...acc, [STAT_KEYS[i]]: n } : acc);
  };
  rec(0, points, {});
  return out;
}

/** Every legal loadout using owned items + affordable purchases (total new cost ≤ gold). */
export function loadoutOptions(state: CombatantState): { loadout: Loadout; purchases: string[]; cost: number }[] {
  const available = ITEMS.filter((i) => state.inventory.includes(i.id) || i.cost <= state.gold);
  const handItems = available.filter((i) => i.category !== 'armour').map((i) => i.id);
  const armours: (string | null)[] = [null, ...available.filter((i) => i.category === 'armour').map((i) => i.id)];
  const hands: [string | null, string | null][] = [[null, null]];
  for (let a = 0; a < handItems.length; a++) {
    hands.push([handItems[a], null]);
    for (let b = a + 1; b < handItems.length; b++) hands.push([handItems[a], handItems[b]]);
  }
  const out: { loadout: Loadout; purchases: string[]; cost: number }[] = [];
  for (const [h1, h2] of hands) {
    for (const armour of armours) {
      const loadout = { hand1: h1, hand2: h2, armour };
      const ids = [h1, h2, armour].filter((x): x is string => x !== null);
      const purchases = ids.filter((id) => !state.inventory.includes(id));
      const cost = purchases.reduce((s, id) => s + requireItem(id).cost, 0);
      if (cost > state.gold) continue;
      if (!isLegalLoadout(loadout, [...state.inventory, ...purchases])) continue;
      out.push({ loadout, purchases, cost });
    }
  }
  return out;
}

/** Opponent scenarios from the player's last observed build. */
export function buildScenarios(observed: CombatantState): Scenario[] {
  const lo = observed.loadout;
  const cat = (id: string | null) => (id ? requireItem(id).category : null);
  const hands = [lo.hand1, lo.hand2];
  const hasRanged = hands.some((h) => cat(h) === 'ranged');
  const hasMelee = hands.some((h) => cat(h) === 'melee');
  const shield = hands.find((h) => cat(h) === 'shield') ?? null;
  const melee = hands.find((h) => cat(h) === 'melee') ?? null;
  const ranged = hands.find((h) => cat(h) === 'ranged') ?? null;

  const make = (kind: 'ranged' | 'melee', loadout: Loadout, hypothetical: string[], pref: AttackMode): Scenario => ({
    kind,
    snapshot: { side: 'player', level: observed.level, stats: { ...observed.stats }, loadout, derived: deriveStats(observed.stats, loadout) },
    preferredMode: pref,
    hypotheticalItems: hypothetical,
  });

  const rangedScenario = hasRanged
    ? make('ranged', { ...lo }, [], 'ranged')
    : make('ranged', { hand1: 'bow', hand2: shield ?? melee, armour: lo.armour }, ['bow'], 'ranged');
  const meleeScenario = hasMelee
    ? make('melee', { ...lo }, [], 'melee')
    : hasRanged
      ? make('melee', { hand1: 'sword', hand2: shield, armour: lo.armour }, ['sword'], 'melee')
      : make('melee', { ...lo }, [], 'unarmed');
  void ranged;
  return [rangedScenario, meleeScenario];
}

/** Analytic expected-duel score in (−1, 1): positive = boss expected to kill first. */
export function analyticScore(boss: FighterSnapshot, sc: Scenario): number {
  const p = sc.snapshot;
  const bMode = bestMode(boss, p).mode;
  const pMode = p.derived.attackModes.includes(sc.preferredMode) ? sc.preferredMode : p.derived.attackModes[0];
  const eB = expectedAttackDamage(boss, p, bMode);
  const eP = expectedAttackDamage(p, boss, pMode);
  const shooters = openingShooters(p, boss).openingOrder; // engine 2.0.0: at most one opening shot
  const openB = shooters.includes('boss') ? expectedAttackDamage(boss, p, 'ranged') : 0;
  const openP = shooters.includes('player') ? expectedAttackDamage(p, boss, 'ranged') : 0;
  const perTurnB = eB * (1 + dexBonusAttacks(boss.derived.effDex, p.derived.effDex));
  const perTurnP = eP * (1 + dexBonusAttacks(p.derived.effDex, boss.derived.effDex));
  const turnsB = Math.max(0, p.derived.maxHp - openB) / Math.max(1e-9, perTurnB);
  const turnsP = Math.max(0, boss.derived.maxHp - openP) / Math.max(1e-9, perTurnP);
  return (turnsP - turnsB) / Math.max(1e-9, turnsP + turnsB);
}

export const bossChooser: Chooser = (ctx) => {
  const att = ctx.state.fighters[ctx.side];
  const def = ctx.state.fighters[ctx.side === 'boss' ? 'player' : 'boss'];
  const { mode, expected } = bestMode(att, def, ctx.options);
  const txt = Object.entries(expected).map(([m, v]) => `${m} ${v.toFixed(2)}`).join(' vs ');
  return { mode, source: 'boss_policy', reason: `Higher expected damage (${txt})` };
};

function scenarioChooser(pref: AttackMode): Chooser {
  return (ctx) => ({ mode: ctx.options.includes(pref) ? pref : ctx.options[0], source: 'agent' });
}

/** Monte-Carlo win rate of a boss build vs a scenario, using the real combat engine. */
export function simulatedWinRate(boss: FighterSnapshot, sc: Scenario, seedBase: string, fights: number): number {
  let wins = 0;
  for (let i = 0; i < fights; i++) {
    const { state } = runFullCombat(sc.snapshot, boss, deriveSeed(seedBase, `${sc.kind}:${i}`), {
      player: scenarioChooser(sc.preferredMode),
      boss: bossChooser,
    });
    if (state.winner === 'boss') wins++;
  }
  return wins / fights;
}

export function applyPlan(state: CombatantState, plan: Plan): CombatantState {
  let s = state;
  for (const [stat, n] of Object.entries(plan.allocation)) if (n) s = allocateStat(s, stat as StatKey, n);
  for (const id of plan.purchases) s = purchase(s, id);
  return equip(s, plan.loadout);
}

export function planLabel(plan: Plan): string {
  const alloc = Object.entries(plan.allocation).filter(([, n]) => n).map(([k, n]) => `+${n} ${k.toUpperCase()}`);
  const gear = [plan.loadout.hand1, plan.loadout.hand2, plan.loadout.armour].filter(Boolean).map((id) => requireItem(id!).name);
  const buys = plan.purchases.map((id) => requireItem(id).name);
  return [
    alloc.length ? alloc.join(', ') : 'no stat change',
    buys.length ? `buy ${buys.join(' + ')} (${plan.cost}g)` : 'no purchase',
    `equip ${gear.length ? gear.join(' + ') : 'nothing (unarmed)'}`,
  ].join('; ');
}

export function choosePlan(input: {
  boss: CombatantState;
  observedPlayer: CombatantState;
  pRanged: number;
  seed: string;
}): PolicyResult {
  const { boss, observedPlayer, pRanged } = input;
  const scenarios = buildScenarios(observedPlayer);
  const [rs, ms] = scenarios;
  const weigh = (r: number, m: number) => pRanged * r + (1 - pRanged) * m;

  const plans: Plan[] = [];
  for (const allocation of allocationOptions(boss.statPoints)) {
    for (const lo of loadoutOptions(boss)) plans.push({ allocation, purchases: lo.purchases, loadout: lo.loadout, cost: lo.cost });
  }
  const scoreAnalytic = (plan: Plan): ScoredPlan => {
    const snap = snapshotOf(applyPlan(boss, plan));
    const a = { ranged: analyticScore(snap, rs), melee: analyticScore(snap, ms) };
    return { ...plan, analytic: a, weighted: weigh(a.ranged, a.melee), label: planLabel(plan) };
  };
  const scored = plans.map(scoreAnalytic).sort((a, b) => b.weighted - a.weighted);

  const currentPlan: Plan = { allocation: {}, purchases: [], loadout: { ...boss.loadout }, cost: 0 };
  const verify = (p: ScoredPlan): ScoredPlan => {
    const snap = snapshotOf(applyPlan(boss, p));
    const wr = {
      ranged: simulatedWinRate(snap, rs, `${input.seed}:mc`, POLICY_CONFIG.fightsPerScenario),
      melee: simulatedWinRate(snap, ms, `${input.seed}:mc`, POLICY_CONFIG.fightsPerScenario),
    };
    return { ...p, winRate: wr, weighted: weigh(wr.ranged, wr.melee) };
  };
  const top = scored.slice(0, POLICY_CONFIG.topK).map(verify);
  const current = verify(scoreAnalytic(currentPlan));

  // Ranking: weighted MC win rate; within tolerance → cheaper, then better analytic margin.
  const best = Math.max(...top.map((p) => p.weighted));
  const near = top.filter((p) => p.weighted >= best - POLICY_CONFIG.scoreTolerance);
  near.sort((a, b) => a.cost - b.cost || weigh(b.analytic.ranged, b.analytic.melee) - weigh(a.analytic.ranged, a.analytic.melee));
  const selected = near[0];

  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const rationale = [
    `P(player mostly ranged next round) = ${pct(pRanged)}; scenarios weighted ${pct(pRanged)} ranged / ${pct(1 - pRanged)} melee.`,
    `Evaluated ${plans.length} legal plan(s) analytically; verified top ${top.length} with ${POLICY_CONFIG.fightsPerScenario} simulated fights per scenario.`,
    `Selected: ${selected.label}.`,
    `Simulated win rate: vs ranged ${pct(selected.winRate!.ranged)}, vs melee ${pct(selected.winRate!.melee)} → weighted ${pct(selected.weighted)} (unchanged build: ${pct(current.weighted)}).`,
    near.length > 1 ? `${near.length} plans scored within ${POLICY_CONFIG.scoreTolerance} of the best; chose the cheapest.` : 'Best plan was clearly ahead of alternatives.',
  ];
  return {
    selected,
    current,
    alternatives: top.filter((p) => p !== selected),
    candidatesEvaluated: plans.length,
    scenarios: scenarios.map((s) => ({ kind: s.kind, loadout: s.snapshot.loadout, preferredMode: s.preferredMode, hypotheticalItems: s.hypotheticalItems })),
    rationale,
  };
}
