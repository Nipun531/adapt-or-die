/**
 * Boss PRE-ROUND DECISION POLICY (constrained decision layer).
 *
 *   observed player state + P(player mostly ranged)  ──►  enumerate LEGAL plans  ──►  score  ──►  pick
 *
 * Policy v2 (engine 2.0.0, V2_DEMANDS §6, default):
 * 1. Enumerate every legal plan: stat-point allocation × loadout reachable with owned items plus purchases the
 *    boss can afford (validated by the same rules as the player).
 * 2. REACHABLE-OPPONENT scenarios (`reachableScenarios`): from the player's last observed state, every way they
 *    could plausibly prepare — each use of their unspent stat points × each style they can actually field (ranged only
 *    if feasible) × the strongest weapon per family they own or can afford. Weights: P(ranged) split over ranged
 *    scenarios, 1 − P over melee ones; P = null (no evidence) → styles weighted equally. The boss never sees the
 *    player's real current-round preparation.
 * 3. Cheap analytic pre-score of all plans, then Monte-Carlo verification of the top plans (plus the best plan of
 *    each archetype) with the REAL combat engine (seeded → reproducible).
 * 4. Score = weighted EXPECTED HP MARGIN (my HP left if I win, −their HP left if I lose) — continuous, so strong
 *    plans no longer all tie at a 100% win rate.
 * 5. CONTROLLED DIVERSITY: plans within `band` of the best score are treated as equally strong; one is drawn with a
 *    seeded, score-weighted draw (lower weight for repeating last round's archetype, mild preference for cheaper
 *    plans). Never outside the band, so diversity cannot cost real strength. The band and the draw are returned.
 *
 * Policy v1 (`version: 'v1-deterministic'`, kept for comparison/rollback): two scenarios (hypothetical Bow/Sword),
 * MC win rate, cheapest plan within 0.02 of the best.
 *
 * The policy only RETURNS a plan; prepare.ts applies it through equipment.ts (which re-validates).
 */
import { ITEMS, requireItem } from '../game/catalog.js';
import { autoStim, openingShooters, runFullCombat, type Chooser, type DefenseChooser, type StimChooser } from '../game/combat.js';
import { deriveStats, snapshotOf } from '../game/derive.js';
import { allocateStat, equip, isLegalLoadout, purchase } from '../game/equipment.js';
import { bestMode, expectedAttackDamage, smartDefense } from '../game/expected.js';
import { RULES_V2, type RuleSet } from '../game/rules.js';
import { dexBonusAttacks } from '../game/formulas.js';
import { deriveSeed, Rng } from '../game/rng.js';
import type { AttackMode, CombatantState, FighterSnapshot, Item, ItemFamily, Loadout, StatKey } from '../game/types.js';
import { STAT_KEYS } from '../game/types.js';
import { rangedFeasibility } from '../ml/features.js';
import { PROB_FLOOR, topCandidates, type HeadProbs } from './forecast.js';
import { headsOf, HEAD_NAMES } from './build-heads.js';

export type PolicyVersion = 'v2-diverse' | 'v1-deterministic';
export const POLICY_VERSION: PolicyVersion = 'v2-diverse';

/**
 * Search settings. Planner lab (docs/ML_WALKTHROUGH.md §15): a 30-plan shortlist with 160 fights and no band gave
 * +0.026 [+0.013, +0.038] HP margin over the V4 settings (V4_SEARCH) at ~0.5 s per decision instead of ~0.04 s, and
 * is what lets exact build knowledge pay (+0.054 more). Keeping the 0.03 band halved the gain.
 */
export const POLICY_CONFIG = {
  topK: 30,                  // best analytic plans verified by Monte-Carlo (v2 adds the best plan of each archetype)
  fightsPerScenario: 16,     // v1: MC fights per scenario per plan
  fightBudgetPerPlan: 160,   // v2: MC fights per plan, spread over the scenarios (fights are near-deterministic)
  minFightsPerScenario: 2,
  scoreTolerance: 0.02,      // v1: plans this close to best are "equivalent" → cheapest wins
  band: 0,                   // v2: plans within this expected-HP-margin of the best are equally strong (0: exact ties only)
  temperature: 0.02,         // v2: softmax temperature on the margin inside the band
  repeatArchetypePenalty: 0.5, // v2: weight factor for repeating last round's archetype
  maxScenarios: 18,
};

export type Allocation = Partial<Record<StatKey, number>>;

/** The V4 search settings (top 6, 40 fights, band 0.03), kept for rollback and to reproduce earlier experiments. */
export const V4_SEARCH = { topK: 6, fightBudget: 40, band: 0.03 } as const;

export interface Plan {
  allocation: Allocation;
  purchases: string[];
  loadout: Loadout;
  cost: number;
}

export type Archetype = 'bruiser' | 'bulwark' | 'duelist' | 'marksman' | 'piercer' | 'hybrid';

/** Per-style aggregates (weighted inside the style); null when the style has no scenario. */
export interface StyleScores { ranged: number | null; melee: number | null }

export interface ScoredPlan extends Plan {
  analytic: StyleScores;
  /** Weighted analytic pre-score (kept after Monte-Carlo verification overwrites `weighted`). */
  analyticWeighted: number;
  winRate?: StyleScores;
  margin?: StyleScores;
  weighted: number;
  label: string;
  archetype: Archetype;
}

export interface Scenario {
  kind: 'ranged' | 'melee';
  snapshot: FighterSnapshot;
  preferredMode: AttackMode;
  hypotheticalItems: string[];
  /** Share of the decision this scenario carries (weights sum to 1). */
  weight?: number;
  label?: string;
  allocation?: Allocation;
  /** V4 hybrid (bow + melee) candidates: the player picks the better mode each attack instead of a fixed one. */
  flexible?: boolean;
}

/**
 * V4: opponent scenarios from a next-build forecast (boss/forecast.ts) — the `k` most likely LEGAL candidate builds,
 * weighted by their renormalised probability. Replaces `reachableScenarios` when a forecast is given.
 */
export const FORECAST_CONFIG = {
  /** Keep the most likely candidates until this much probability is covered ... */
  massTarget: 0.95,
  /** ... but drop any below this weight (they would only dilute the Monte-Carlo budget). */
  minWeight: 0.01,
};

export function forecastScenarios(observed: CombatantState, heads: HeadProbs, k = POLICY_CONFIG.maxScenarios, base: 'v4' | 'v3' = 'v4'): { scenarios: Scenario[]; massCovered: number; legal: number } {
  if (base === 'v3') return reweightReachable(observed, heads);
  const { picked: all, legal } = topCandidates(observed, heads, k);
  const picked: typeof all = [];
  let acc = 0;
  for (const p of all) {
    if (picked.length && (acc >= FORECAST_CONFIG.massTarget || p.weight < FORECAST_CONFIG.minWeight)) break;
    picked.push(p);
    acc += p.weight;
  }
  const massCovered = acc;
  for (const p of picked) p.weight /= acc;
  const scenarios = picked.map(({ candidate: c, weight }): Scenario => {
    const h = c.heads.hands;
    const ranged = h === 'ranged' || h === 'ranged_shield' || h === 'ranged_melee';
    const melee = h === 'melee' || h === 'melee_shield' || h === 'ranged_melee';
    return {
      kind: ranged && !melee ? 'ranged' : 'melee',
      snapshot: c.snapshot,
      preferredMode: ranged && !melee ? 'ranged' : melee ? 'melee' : 'unarmed',
      flexible: h === 'ranged_melee',
      hypotheticalItems: c.purchases,
      weight,
      label: c.label,
    };
  });
  return { scenarios, massCovered, legal };
}

export interface BandEntry { label: string; archetype: Archetype; weighted: number; cost: number; probability: number }

export interface PolicyResult {
  version: PolicyVersion;
  selected: ScoredPlan;
  current: ScoredPlan;
  alternatives: ScoredPlan[];
  candidatesEvaluated: number;
  scenarios: { kind: string; label?: string; weight?: number; loadout: Loadout; preferredMode: AttackMode; hypotheticalItems: string[]; allocation?: Allocation }[];
  /** v2: the equally-strong plans the pick was drawn from, with their draw probabilities. */
  band?: BandEntry[];
  draw?: number;
  /** v2: the search settings this decision used (stored with every decision; V4 decisions predate the field). */
  search?: { topK: number; fightBudget: number; band: number };
  rationale: string[];
}

/** All ways to spend exactly `points` across the 4 stats (84 splits for 6 points); larger pools: dumps + even splits. */
export function allocationOptions(points: number): Allocation[] {
  if (points <= 0) return [{}];
  if (points > 6) {
    const half = Math.floor(points / 2);
    const out: Allocation[] = STAT_KEYS.map((k) => ({ [k]: points }) as Allocation);
    for (let i = 0; i < STAT_KEYS.length; i++) {
      for (let j = i + 1; j < STAT_KEYS.length; j++) out.push({ [STAT_KEYS[i]]: half, [STAT_KEYS[j]]: points - half } as Allocation);
    }
    return out;
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

const snapFor = (observed: CombatantState, stats: CombatantState['stats'], loadout: Loadout): FighterSnapshot =>
  ({ side: 'player', level: observed.level, stats: { ...stats }, loadout, derived: deriveStats(stats, loadout) });

/** V1 opponent scenarios: last observed build, hypothetically assuming a Bow/Sword if missing (policy v1 only). */
export function buildScenarios(observed: CombatantState): Scenario[] {
  const lo = observed.loadout;
  const cat = (id: string | null) => (id ? requireItem(id).category : null);
  const hands = [lo.hand1, lo.hand2];
  const hasRanged = hands.some((h) => cat(h) === 'ranged');
  const hasMelee = hands.some((h) => cat(h) === 'melee');
  const shield = hands.find((h) => cat(h) === 'shield') ?? null;
  const melee = hands.find((h) => cat(h) === 'melee') ?? null;
  const make = (kind: 'ranged' | 'melee', loadout: Loadout, hypothetical: string[], pref: AttackMode): Scenario => ({
    kind, snapshot: snapFor(observed, observed.stats, loadout), preferredMode: pref, hypotheticalItems: hypothetical,
  });
  const rangedScenario = hasRanged
    ? make('ranged', { ...lo }, [], 'ranged')
    : make('ranged', { hand1: 'bow', hand2: shield ?? melee, armour: lo.armour }, ['bow'], 'ranged');
  const meleeScenario = hasMelee
    ? make('melee', { ...lo }, [], 'melee')
    : hasRanged
      ? make('melee', { hand1: 'sword', hand2: shield, armour: lo.armour }, ['sword'], 'melee')
      : make('melee', { ...lo }, [], 'unarmed');
  return [rangedScenario, meleeScenario];
}

/**
 * V2 REACHABLE-OPPONENT scenarios (V2_DEMANDS D-DIV-1). Uses only decision-time information: the player's last
 * observed post-round state (stats, unspent points, gold, inventory, loadout).
 *  - allocations of the unspent points: all into STR / DEX / DEF / HP for melee, DEX / HP for ranged (none if 0 points)
 *  - melee weapons: per family (blade, blunt, polearm) the most expensive one they own or can afford, plus the
 *    weapon they last used; unarmed if none
 *  - ranged: only if feasible (owns one or can afford one) — the most expensive owned/affordable bow
 *  - shield and armour stay as observed (melee: shield kept; ranged: shield, else their melee weapon, as 2nd hand)
 * Weights: pRanged over ranged scenarios, 1 − pRanged over melee ones, equal inside a style; pRanged = null → equal
 * style weights. Zero-weight scenarios are dropped.
 */
export function reachableScenarios(observed: CombatantState, pRanged: number | null): Scenario[] {
  const lo = observed.loadout;
  const cat = (id: string | null) => (id ? requireItem(id).category : null);
  const shield = [lo.hand1, lo.hand2].find((h) => cat(h) === 'shield') ?? null;
  const lastMelee = [lo.hand1, lo.hand2].find((h) => cat(h) === 'melee') ?? null;
  const reachable = (i: Item) => observed.inventory.includes(i.id) || i.cost <= observed.gold;
  const strongest = (items: Item[]) => items.filter(reachable).sort((a, b) => b.cost - a.cost || a.id.localeCompare(b.id))[0];
  const hypo = (id: string) => (observed.inventory.includes(id) ? [] : [id]);

  const meleeWeapons = new Set<string>();
  for (const fam of ['blade', 'blunt', 'polearm'] as ItemFamily[]) {
    const w = strongest(ITEMS.filter((i) => i.category === 'melee' && i.family === fam));
    if (w) meleeWeapons.add(w.id);
  }
  if (lastMelee) meleeWeapons.add(lastMelee);
  const rangedWeapon = rangedFeasibility(observed).rangedFeasible ? strongest(ITEMS.filter((i) => i.category === 'ranged')) : undefined;

  const allocs = (keys: StatKey[]): Allocation[] => (observed.statPoints > 0 ? keys.map((k) => ({ [k]: observed.statPoints }) as Allocation) : [{}]);
  const statsAfter = (a: Allocation) => {
    let s = { ...observed, statPoints: observed.statPoints };
    for (const [k, n] of Object.entries(a)) if (n) s = allocateStat(s, k as StatKey, n);
    return s.stats;
  };
  const allocText = (a: Allocation) => Object.entries(a).map(([k, n]) => `+${n} ${k.toUpperCase()}`).join(', ') || 'no points';

  const melee: Scenario[] = [];
  const meleeList = meleeWeapons.size ? [...meleeWeapons] : [null];
  for (const w of meleeList) {
    for (const a of allocs(['str', 'dex', 'def', 'hp'])) {
      const loadout: Loadout = { hand1: w, hand2: shield, armour: lo.armour };
      melee.push({
        kind: 'melee', snapshot: snapFor(observed, statsAfter(a), loadout), preferredMode: w ? 'melee' : 'unarmed',
        hypotheticalItems: w ? hypo(w) : [], allocation: a, label: `${w ? requireItem(w).name : 'unarmed'}, ${allocText(a)}`,
      });
    }
  }
  const ranged: Scenario[] = [];
  if (rangedWeapon) {
    for (const a of allocs(['dex', 'hp'])) {
      const loadout: Loadout = { hand1: rangedWeapon.id, hand2: shield ?? lastMelee, armour: lo.armour };
      ranged.push({
        kind: 'ranged', snapshot: snapFor(observed, statsAfter(a), loadout), preferredMode: 'ranged',
        hypotheticalItems: hypo(rangedWeapon.id), allocation: a, label: `${rangedWeapon.name}, ${allocText(a)}`,
      });
    }
  }
  // Weights by style. Melee is always reachable (unarmed at worst).
  let wR = ranged.length ? (pRanged ?? 0.5) : 0;
  if (!melee.length) wR = 1;
  const wM = 1 - wR;
  for (const s of ranged) s.weight = wR / ranged.length;
  for (const s of melee) s.weight = wM / melee.length;
  return [...ranged, ...melee].filter((s) => (s.weight ?? 0) > 0).slice(0, POLICY_CONFIG.maxScenarios);
}

/**
 * V4 variant: keep the V3 reachable scenarios (their builds), but weight each by the forecast probability of its
 * heads instead of by P(ranged) alone. Tests whether head knowledge helps when the scenario builds stay the same.
 */
export function reweightReachable(observed: CombatantState, heads: HeadProbs): { scenarios: Scenario[]; massCovered: number; legal: number } {
  const sc = reachableScenarios(observed, null);
  const raw = sc.map((s) => HEAD_NAMES.reduce((p, h) => p * Math.max(PROB_FLOOR, heads[h][headsOf(observed, s.snapshot)[h]] ?? 0), 1));
  const z = raw.reduce((a, b) => a + b, 0);
  sc.forEach((s, i) => { s.weight = raw[i] / z; });
  return { scenarios: sc.filter((s) => (s.weight ?? 0) >= FORECAST_CONFIG.minWeight), massCovered: 1, legal: sc.length };
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
  const att = ctx.view.fighters[ctx.side];
  const def = ctx.view.fighters[ctx.side === 'boss' ? 'player' : 'boss'];
  const { mode, expected } = bestMode(att, def, ctx.options);
  const txt = Object.entries(expected).map(([m, v]) => `${m} ${v.toFixed(2)}`).join(' vs ');
  return { mode, source: 'boss_policy', reason: `Higher expected damage (${txt})` };
};

function scenarioChooser(pref: AttackMode): Chooser {
  return (ctx) => ({ mode: ctx.options.includes(pref) ? pref : ctx.options[0], source: 'agent' });
}

/** Monte-Carlo outcome of a boss build vs a scenario, using the real combat engine: win rate + expected HP margin. */
/** V3: the boss defends by expected value and heals with the automatic rule (public odds only). */
export const bossDefense = (rules: RuleSet): DefenseChooser => smartDefense(rules, 'boss_policy');
export const bossStim: StimChooser = autoStim;

/** Extra combat options for a rule set: v3 adds both fighters' defence/stim policies (a competent opponent is assumed). */
function v3Options(rules: RuleSet, playerDefense?: DefenseChooser) {
  return rules.v3
    ? { rules, defense: { player: playerDefense ?? smartDefense(rules), boss: bossDefense(rules) }, stim: { player: autoStim, boss: bossStim } }
    : { rules };
}

export function simulatedOutcome(boss: FighterSnapshot, sc: Scenario, seedBase: string, fights: number, rules: RuleSet = RULES_V2, playerDefense?: DefenseChooser): { winRate: number; margin: number } {
  let wins = 0;
  let margin = 0;
  const key = sc.label ?? sc.kind;
  for (let i = 0; i < fights; i++) {
    const { state } = runFullCombat(sc.snapshot, boss, deriveSeed(seedBase, `${key}:${i}`), {
      player: sc.flexible ? bossChooser : scenarioChooser(sc.preferredMode),
      boss: bossChooser,
    }, v3Options(rules, playerDefense));
    if (state.winner === 'boss') {
      wins++;
      margin += Math.max(0, state.hp.boss) / boss.derived.maxHp;
    } else {
      margin -= Math.max(0, state.hp.player) / sc.snapshot.derived.maxHp;
    }
  }
  return { winRate: wins / fights, margin: margin / fights };
}

/** Monte-Carlo win rate of a boss build vs a scenario (policy v1). */
export function simulatedWinRate(boss: FighterSnapshot, sc: Scenario, seedBase: string, fights: number, rules: RuleSet = RULES_V2): number {
  let wins = 0;
  for (let i = 0; i < fights; i++) {
    const { state } = runFullCombat(sc.snapshot, boss, deriveSeed(seedBase, `${sc.kind}:${i}`), {
      player: scenarioChooser(sc.preferredMode),
      boss: bossChooser,
    }, v3Options(rules));
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

/**
 * Archetype of a plan (explanation + diversity only, no rule effect):
 * ranged + melee → hybrid; ranged only → marksman; a melee weapon with pierce EV (chance × DEF-ignore) ≥ 0.15 → piercer;
 * otherwise the stat this plan invests in most (STR → bruiser, DEX → duelist, DEF/HP → bulwark), or — with no points —
 * the gear (DEF-heavy shield/armour → bulwark, DEX blade → duelist, else bruiser).
 */
export function archetypeOf(plan: Plan): Archetype {
  const ids = [plan.loadout.hand1, plan.loadout.hand2].filter((x): x is string => x !== null).map(requireItem);
  const melee = ids.find((i) => i.category === 'melee');
  const ranged = ids.find((i) => i.category === 'ranged');
  if (ranged && melee) return 'hybrid';
  if (ranged) return 'marksman';
  if (melee?.pierce && melee.pierce.chance * melee.pierce.defIgnore >= 0.15) return 'piercer';
  const alloc = Object.entries(plan.allocation).filter(([, n]) => n).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  if (alloc.length) {
    const k = alloc[0][0];
    return k === 'str' ? 'bruiser' : k === 'dex' ? 'duelist' : 'bulwark';
  }
  const armour = plan.loadout.armour ? requireItem(plan.loadout.armour) : null;
  const shield = ids.find((i) => i.category === 'shield');
  if ((armour?.mods.def ?? 0) + (shield?.mods.def ?? 0) >= 8) return 'bulwark';
  if (melee && melee.mods.dex > 0) return 'duelist';
  return 'bruiser';
}

/**
 * Harness-only planner knobs (docs/ML_WALKTHROUGH.md §15). Every field defaults to the live POLICY_CONFIG, so leaving this
 * out gives the live choices (V4_SEARCH gives the V4 ones). Not used by boss/prepare.ts.
 *  objective  'expected' (live): weighted mean HP margin over the scenarios; 'worst': the margin vs the worst
 *             scenario; 'regret': minus the largest shortfall vs the best plan for any scenario (minimax regret).
 *  fightBudget  Monte-Carlo fights per plan (live: POLICY_CONFIG.fightBudgetPerPlan).
 *  topK       analytic plans verified by Monte-Carlo (live: POLICY_CONFIG.topK).
 *  band       diversity band (live: POLICY_CONFIG.band; 0 = always the best verified plan).
 */
export interface PlannerOptions { objective?: 'expected' | 'worst' | 'regret'; fightBudget?: number; topK?: number; band?: number }

export function choosePlan(input: {
  boss: CombatantState;
  observedPlayer: CombatantState;
  /** P(player mostly ranged next round); null = no evidence (styles weighted equally, v2). */
  pRanged: number | null;
  seed: string;
  /** Archetype the boss used last round (v2 diversity: repeating it is less likely among equal plans). */
  previousArchetype?: Archetype | null;
  version?: PolicyVersion;
  /** Combat rules the Monte-Carlo verification uses (default v2 = live engine 2.0.0). */
  rules?: RuleSet;
  /** V3: how the player is assumed to defend in the Monte-Carlo (default: a smart, expected-value defender). */
  playerDefense?: DefenseChooser;
  /** V4: opponent scenarios from a next-build forecast (forecastScenarios). Default: reachableScenarios(pRanged). */
  opponents?: Scenario[];
  /** Harness only (see PlannerOptions). Omitted live. */
  planner?: PlannerOptions;
}): PolicyResult {
  const version = input.version ?? POLICY_VERSION;
  const { boss, observedPlayer } = input;
  const v1 = version === 'v1-deterministic';
  const pForV1 = input.pRanged ?? 0.5;
  const scenarios: Scenario[] = v1
    ? buildScenarios(observedPlayer).map((s) => ({ ...s, weight: s.kind === 'ranged' ? pForV1 : 1 - pForV1 }))
    : input.opponents ?? reachableScenarios(observedPlayer, input.pRanged);

  const byStyle = (vals: number[]): StyleScores => {
    const agg = (kind: 'ranged' | 'melee') => {
      let w = 0;
      let v = 0;
      scenarios.forEach((s, i) => { if (s.kind === kind) { w += s.weight ?? 0; v += (s.weight ?? 0) * vals[i]; } });
      return w > 0 ? v / w : null;
    };
    return { ranged: agg('ranged'), melee: agg('melee') };
  };
  const weigh = (vals: number[]) => scenarios.reduce((sum, s, i) => sum + (s.weight ?? 0) * vals[i], 0);
  const objective = input.planner?.objective ?? 'expected';
  const budget = input.planner?.fightBudget ?? POLICY_CONFIG.fightBudgetPerPlan;
  const topK = input.planner?.topK ?? POLICY_CONFIG.topK;
  const bandWidth = input.planner?.band ?? POLICY_CONFIG.band;
  /** Objective over per-scenario values; `best[i]` = the best value any compared plan reaches vs scenario i (regret). */
  const objectiveOf = (vals: number[], best?: number[]) => objective === 'worst'
    ? Math.min(...vals)
    : objective === 'regret' && best
      ? -Math.max(...vals.map((v, i) => best[i] - v))
      : weigh(vals);
  const bestPer = (rows: number[][]) => scenarios.map((_, i) => Math.max(...rows.map((r) => r[i])));

  const plans: Plan[] = [];
  for (const allocation of allocationOptions(boss.statPoints)) {
    for (const lo of loadoutOptions(boss)) plans.push({ allocation, purchases: lo.purchases, loadout: lo.loadout, cost: lo.cost });
  }
  const analyticVals = new Map<Plan, number[]>();
  const scoreAnalytic = (plan: Plan): ScoredPlan => {
    const snap = snapshotOf(applyPlan(boss, plan));
    const vals = scenarios.map((sc) => analyticScore(snap, sc));
    analyticVals.set(plan, vals);
    const w = weigh(vals);
    return { ...plan, analytic: byStyle(vals), analyticWeighted: w, weighted: w, label: planLabel(plan), archetype: archetypeOf(plan) };
  };
  const scored = plans.map(scoreAnalytic);
  if (objective !== 'expected') {
    const best = bestPer([...analyticVals.values()]);
    scored.forEach((p, i) => { p.weighted = objectiveOf(analyticVals.get(plans[i])!, best); });
  }
  scored.sort((a, b) => b.weighted - a.weighted);

  const fights = v1
    ? POLICY_CONFIG.fightsPerScenario
    : Math.max(POLICY_CONFIG.minFightsPerScenario, Math.floor(budget / Math.max(1, scenarios.length)));
  const mcVals = new Map<ScoredPlan, number[]>();
  const verify = (p: ScoredPlan): ScoredPlan => {
    const snap = snapshotOf(applyPlan(boss, p));
    if (v1) {
      const wr = scenarios.map((sc) => simulatedWinRate(snap, sc, `${input.seed}:mc`, fights, input.rules));
      return { ...p, winRate: byStyle(wr), weighted: weigh(wr) };
    }
    // V4 forecast scenarios: the fight budget follows the probability (a likely build gets most fights, an unlikely one
    // keeps the minimum), instead of an equal split that would starve the build that matters.
    const fightsFor = (sc: Scenario) => (input.opponents
      ? Math.max(POLICY_CONFIG.minFightsPerScenario, Math.round(budget * (sc.weight ?? 0)))
      : fights);
    const out = scenarios.map((sc) => simulatedOutcome(snap, sc, `${input.seed}:mc`, fightsFor(sc), input.rules, input.playerDefense));
    const r: ScoredPlan = { ...p, winRate: byStyle(out.map((o) => o.winRate)), margin: byStyle(out.map((o) => o.margin)), weighted: weigh(out.map((o) => o.margin)) };
    mcVals.set(r, out.map((o) => o.margin));
    return r;
  };

  // Candidates: top-K analytic plans; v2 also adds the best analytic plan of every archetype (so the band can be diverse).
  const candidates = scored.slice(0, topK);
  if (!v1) {
    for (const p of scored) if (!candidates.some((c) => c.archetype === p.archetype)) candidates.push(p);
  }
  const top = candidates.map(verify);
  const current = verify(scoreAnalytic({ allocation: {}, purchases: [], loadout: { ...boss.loadout }, cost: 0 }));
  if (!v1 && objective !== 'expected') {
    const best = bestPer([...top, current].map((p) => mcVals.get(p)!));
    for (const p of [...top, current]) p.weighted = objectiveOf(mcVals.get(p)!, best);
  }

  const pct = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`);
  const pText = input.pRanged === null
    ? 'No evidence about the player\'s style yet → reachable styles weighted equally (robustness rule, not a prediction).'
    : `P(player mostly ranged next round) = ${pct(input.pRanged)}.`;
  const scenText = `${scenarios.length} reachable opponent scenario(s): ${scenarios.filter((s) => s.kind === 'ranged').length} ranged, ${scenarios.filter((s) => s.kind === 'melee').length} melee.`;

  if (v1) {
    const best = Math.max(...top.map((p) => p.weighted));
    const near = top.filter((p) => p.weighted >= best - POLICY_CONFIG.scoreTolerance);
    near.sort((a, b) => a.cost - b.cost || b.analyticWeighted - a.analyticWeighted);
    const selected = near[0];
    return {
      version, selected, current, alternatives: top.filter((p) => p !== selected), candidatesEvaluated: plans.length,
      scenarios: scenarios.map(scenarioSummary),
      rationale: [
        pText,
        `Evaluated ${plans.length} legal plan(s) analytically; verified top ${top.length} with ${fights} simulated fights per scenario.`,
        `Selected: ${selected.label}.`,
        `Simulated win rate: vs ranged ${pct(selected.winRate!.ranged)}, vs melee ${pct(selected.winRate!.melee)} → weighted ${pct(selected.weighted)} (unchanged build: ${pct(current.weighted)}).`,
        near.length > 1 ? `${near.length} plans scored within ${POLICY_CONFIG.scoreTolerance} of the best; chose the cheapest.` : 'Best plan was clearly ahead of alternatives.',
      ],
    };
  }

  // v2: controlled diversity inside the band of equally strong plans.
  const best = Math.max(...top.map((p) => p.weighted));
  const band = top.filter((p) => p.weighted >= best - bandWidth);
  const raw = band.map((p) => Math.exp((p.weighted - best) / POLICY_CONFIG.temperature)
    * (input.previousArchetype && p.archetype === input.previousArchetype ? POLICY_CONFIG.repeatArchetypePenalty : 1)
    / (1 + p.cost / 100));
  const total = raw.reduce((a, b) => a + b, 0);
  const probs = raw.map((r) => r / total);
  const draw = new Rng(deriveSeed(input.seed, 'pick')).next();
  let acc = 0;
  let idx = band.length - 1;
  for (let i = 0; i < band.length; i++) {
    acc += probs[i];
    if (draw < acc) { idx = i; break; }
  }
  const selected = band[idx];
  const sign = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(2)}`;
  const archetypes = [...new Set(band.map((p) => p.archetype))];
  return {
    version, selected, current, alternatives: top.filter((p) => p !== selected), candidatesEvaluated: plans.length,
    scenarios: scenarios.map(scenarioSummary),
    search: { topK, fightBudget: budget, band: bandWidth },
    band: band.map((p, i) => ({ label: p.label, archetype: p.archetype, weighted: p.weighted, cost: p.cost, probability: probs[i] })),
    draw,
    rationale: [
      pText,
      scenText,
      `Evaluated ${plans.length} legal plan(s) analytically; verified ${top.length} (top ${topK} + best of each archetype) with ${fights} simulated fight(s) per scenario.`,
      `Selected (${selected.archetype}): ${selected.label}.`,
      `Expected HP margin ${sign(selected.weighted)} (unchanged build: ${sign(current.weighted)}); simulated win rate vs ranged ${pct(selected.winRate!.ranged)}, vs melee ${pct(selected.winRate!.melee)}.`,
      band.length > 1
        ? `${band.length} plans were equally strong (within ${bandWidth} of the best margin; archetypes: ${archetypes.join(', ')}); picked one by a seeded draw (p = ${Math.round(probs[idx] * 100)}%)${input.previousArchetype ? `, favouring a change from last round's ${input.previousArchetype}` : ''}.`
        : 'Best plan was clearly ahead of alternatives.',
    ],
  };
}

function scenarioSummary(s: Scenario) {
  return { kind: s.kind, label: s.label, weight: s.weight, loadout: s.snapshot.loadout, preferredMode: s.preferredMode, hypotheticalItems: s.hypotheticalItems, allocation: s.allocation };
}
