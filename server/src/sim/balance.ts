/**
 * BALANCE HARNESS (V2 Phase 3) — pure engine, NO database reads or writes.
 *
 * 1. `playInMemoryRun`  — a full run (agent vs the real boss policy) that mirrors services/rounds.ts step by step
 *    (same rules, same seed derivations, same boss preparation with the transparent baseline predictor), but in memory.
 *    Used for boss win rates per agent, item usage and pierce contribution.
 * 2. `weaponMatrix`     — every weapon, in its price bracket, against five opponent archetypes at the matching level
 *    tier. The test fighter gets the best stat allocation / armour / shield for that weapon (analytic pre-screen,
 *    then seeded Monte-Carlo with the real combat engine). Answers "is this weapon a valid choice, and against what?".
 * 3. `withPierce`       — temporarily overrides pierce specs (harness-only) so pierce values can be swept.
 *
 * Nothing here is a game rule. Results feed docs/V2_BALANCE.md.
 */
import { ITEMS, requireItem } from '../game/catalog.js';
import { autoStim, runFullCombat, type Chooser, type CombatEvent } from '../game/combat.js';
import { RULES_V2, type RuleSet } from '../game/rules.js';
import { AGENT_DEFENSE, defenseChooserFor } from './v3-policies.js';
import { autoSupplies, SIM_SAVINGS_RESERVE } from '../game/supply-plan.js';
import { deriveStats, snapshotOf } from '../game/derive.js';
import { allocateStat, equip, purchase } from '../game/equipment.js';
import { applyRoundRewards, initialCombatant } from '../game/progression.js';
import { deriveSeed, Rng } from '../game/rng.js';
import { summarizeCombat } from '../game/summary.js';
import type { CombatantState, FighterSnapshot, Item, Loadout, PierceSpec, Side, StatKey, Stats } from '../game/types.js';
import { BASE_STATS, INITIAL_STAT_POINTS, LEVEL_UP_INCREASE, STAT_ALLOCATION_INCREASE } from '../game/constants.js';
import { analyticScore, applyPlan, bossChooser, bossDefense, bossStim, choosePlan, type Archetype as BossArchetype, type PolicyVersion, type Scenario } from '../boss/policy.js';
import { baselineProbability, rangedFeasibility, type RoundRecord } from '../ml/features.js';
import { requireAgent, type RoundOutcome } from './agents.js';

// ---------------------------------------------------------------------------------------------------------------
// 1. In-memory full runs
// ---------------------------------------------------------------------------------------------------------------

export interface RoundResult {
  roundNumber: number;
  winner: Side;
  playerLoadout: Loadout;
  bossLoadout: Loadout;
  bossAllocation: Partial<Record<StatKey, number>>;
  bossArchetype: BossArchetype;
  /** Number of equally strong plans the boss drew from (policy v2; 1 = clear best). */
  bossBandSize: number;
  /** Boss HP left fraction if it won, −(player HP left fraction) if it lost. */
  bossMargin: number;
  /** P(ranged) the boss used for this round's preparation (null = no evidence). */
  pRanged: number | null;
  events: CombatEvent[];
}

export interface RunResult {
  strategy: string;
  seed: string;
  rounds: RoundResult[];
  player: CombatantState;
  boss: CombatantState;
}

/**
 * Harness-only strategy: the player uses THE BOSS'S OWN POLICY (choosePlan) against the boss's last observed build.
 * Both sides then have the same information and the same intelligence, so its win rate measures the fairness of
 * the RULES, separately from how much smarter the boss is than the scripted agents.
 */
export const MIRROR = 'mirror';
/**
 * Harness-only, V3 Phase C1: an exactly symmetric mirror. Like MIRROR, but the player also gets the boss's predictor
 * (baselinePredict on the role-swapped history, feasibility check included) and the boss's anti-repeat diversity
 * penalty. Any remaining win-rate gap is then a structural asymmetry of the rules or the run loop.
 */
export const MIRROR_SYM = 'mirror_sym';
const isMirror = (s: string) => s === MIRROR || s === MIRROR_SYM;

/** A completed round seen from the boss's side (so boss-side predictors can be reused for the player). */
function swapRecord(r: RoundRecord, bossPost: CombatantState): RoundRecord {
  return {
    roundNumber: r.roundNumber,
    winner: r.winner === 'boss' ? 'player' : 'boss',
    playerSnapshot: { ...r.bossSnapshot, side: 'player' },
    bossSnapshot: { ...r.playerSnapshot, side: 'boss' },
    playerPost: { ...bossPost, side: 'player' },
    playerHpEnd: r.bossHpEnd,
    bossHpEnd: r.playerHpEnd,
    summary: { ...r.summary, player: r.summary.boss, boss: r.summary.player },
  };
}

/** What the boss's predictor is asked before each round (decision-time information only). */
export interface PredictionRequest { records: RoundRecord[]; observed: CombatantState }
/** Returns P(player mostly ranged) or null (no evidence). */
export type InMemoryPredictor = (req: PredictionRequest) => Promise<number | null>;

/** Same as boss/prepare.ts with the baseline predictor: rule-level feasibility first, then the baseline. */
export function baselinePredict({ records, observed }: PredictionRequest): number | null {
  return rangedFeasibility(observed).rangedFeasible ? baselineProbability(records) : 0;
}

/**
 * The run loop as a generator: it yields a PredictionRequest before every boss preparation and expects
 * P(ranged) back, so the same loop serves the synchronous baseline driver and the async model driver.
 */
function* runSteps(strategy: string, runSeed: string, maxRounds: number, opts: RunOptions): Generator<PredictionRequest, RunResult, number | null> {
  const rules = opts.rules ?? RULES_V2;
  let previousArchetype: BossArchetype | null = null;
  const agent = isMirror(strategy) ? requireAgent('hybrid') /* chooser only */ : requireAgent(strategy);
  const swapped: RoundRecord[] = [];
  let playerPrevArchetype: BossArchetype | null = null;
  let player = initialCombatant('player');
  let boss = initialCombatant('boss');
  const history: RoundOutcome[] = [];
  const records: RoundRecord[] = [];
  const rounds: RoundResult[] = [];

  for (let n = 1; n <= maxRounds; n++) {
    if (strategy === MIRROR) {
      const bossSeen = boss; // the boss before its own prep = its last observed build + level-ups (what a player can see)
      const flags = records.map((r) => ((r.summary.boss.rangedShare ?? 0) >= 0.5 ? 1 : 0));
      const pBossRanged = flags.length ? 0.5 * flags[flags.length - 1] + 0.5 * (flags.reduce((a: number, c) => a + c, 0) + 1) / (flags.length + 2) : 0.5;
      const plan = choosePlan({ boss: player, observedPlayer: { ...bossSeen, side: 'player' }, pRanged: pBossRanged, seed: String(deriveSeed(runSeed, `mirror:${n}`)), rules: opts.rules });
      player = applyPlan(player, plan.selected);
    } else if (strategy === MIRROR_SYM) {
      const seen: CombatantState = { ...boss, side: 'player' };
      const plan = choosePlan({
        boss: player, observedPlayer: seen, pRanged: baselinePredict({ records: swapped, observed: seen }),
        seed: String(deriveSeed(runSeed, `mirror:${n}`)), previousArchetype: playerPrevArchetype, version: opts.policyVersion, rules: opts.rules,
      });
      playerPrevArchetype = plan.selected.archetype;
      player = applyPlan(player, plan.selected);
    } else {
      const d = agent.decide({ roundNumber: n, state: player, history: [...history], rng: new Rng(deriveSeed(runSeed, `agent:${n}`)), runSeed });
      for (const a of d.allocations) player = allocateStat(player, a.stat, a.points);
      for (const id of d.purchases) player = purchase(player, id);
      player = equip(player, d.loadout);
    }
    if (rules.v3) player = autoSupplies(player, SIM_SAVINGS_RESERVE).state;

    const observed = records.length ? records[records.length - 1].playerPost : initialCombatant('player');
    const pRanged = yield { records: [...records], observed };
    const policy = choosePlan({
      boss, observedPlayer: observed, pRanged, seed: String(deriveSeed(runSeed, `boss:${n}`)), previousArchetype, version: opts.policyVersion, rules: opts.rules,
    });
    previousArchetype = policy.selected.archetype;
    boss = applyPlan(boss, policy.selected);
    if (rules.v3) boss = autoSupplies(boss).state; // as boss/prepare.ts

    const pSnap = snapshotOf(player);
    const bSnap = snapshotOf(boss);
    const chooser = isMirror(strategy) ? bossChooser : agent.chooser(new Rng(deriveSeed(runSeed, `agent-choice:${n}`)));
    const { state, events } = runFullCombat(pSnap, bSnap, deriveSeed(runSeed, `round:${n}`), { player: chooser, boss: bossChooser }, rules.v3 ? {
      rules,
      defense: {
        player: defenseChooserFor(isMirror(strategy) ? 'smart' : AGENT_DEFENSE[strategy] ?? 'smart', new Rng(deriveSeed(runSeed, `agent-defense:${n}`)), rules),
        boss: bossDefense(rules),
      },
      stim: { player: autoStim, boss: bossStim },
    } : {});
    const winner = state.winner!;
    // V3: used stims are gone (as services/rounds.ts completeRound).
    if (state.v3) {
      if (player.supplies) player = { ...player, supplies: { ...player.supplies, stims: state.v3.stims.player } };
      if (boss.supplies) boss = { ...boss, supplies: { ...boss.supplies, stims: state.v3.stims.boss } };
    }
    player = applyRoundRewards(player, winner === 'player').state;
    boss = applyRoundRewards(boss, winner === 'boss').state;

    records.push({
      roundNumber: n, winner, playerSnapshot: pSnap, bossSnapshot: bSnap, playerPost: player,
      playerHpEnd: state.hp.player, bossHpEnd: state.hp.boss, summary: summarizeCombat(events),
    });
    if (strategy === MIRROR_SYM) swapped.push(swapRecord(records[records.length - 1], boss));
    history.push({ roundNumber: n, winner, bossLoadout: bSnap.loadout, playerHpEndFrac: Math.max(0, state.hp.player) / pSnap.derived.maxHp });
    const bossMargin = winner === 'boss' ? Math.max(0, state.hp.boss) / bSnap.derived.maxHp : -Math.max(0, state.hp.player) / pSnap.derived.maxHp;
    rounds.push({
      roundNumber: n, winner, playerLoadout: pSnap.loadout, bossLoadout: bSnap.loadout, bossAllocation: policy.selected.allocation,
      bossArchetype: policy.selected.archetype, bossBandSize: policy.band?.length ?? 1, bossMargin, pRanged, events,
    });
  }
  return { strategy, seed: runSeed, rounds, player, boss };
}

/** One complete run without the database. Mirrors sim/runner.ts → services/rounds.ts (baseline predictor). */
/** Harness run options: boss policy version and combat rules (default v2 = engine 2.0.0). */
export interface RunOptions { policyVersion?: PolicyVersion; rules?: RuleSet }

export function playInMemoryRun(strategy: string, runSeed: string, maxRounds = 10, opts: RunOptions = {}): RunResult {
  const it = runSteps(strategy, runSeed, maxRounds, opts);
  let step = it.next();
  while (!step.done) step = it.next(baselinePredict(step.value));
  return step.value;
}

/** Same run, but the boss's P(ranged) comes from `predict` (e.g. a trained model or ensemble). Identical seeds → paired comparison. */
export async function playInMemoryRunWith(strategy: string, runSeed: string, predict: InMemoryPredictor, maxRounds = 10, opts: RunOptions = {}): Promise<RunResult> {
  const it = runSteps(strategy, runSeed, maxRounds, opts);
  let step = it.next();
  while (!step.done) step = it.next(await predict(step.value));
  return step.value;
}

export interface RunBatchSummary {
  strategy: string;
  runs: number;
  rounds: number;
  bossWinRate: number;
  roundOneBossWinRate: number;
  /** Share of all damage (both sides) that came from successful pierces' extra damage. */
  pierceDamageShare: number;
}

export function summarizeRuns(results: RunResult[]): RunBatchSummary[] {
  const by = new Map<string, RunResult[]>();
  for (const r of results) by.set(r.strategy, [...(by.get(r.strategy) ?? []), r]);
  return [...by.entries()].map(([strategy, rs]) => {
    const all = rs.flatMap((r) => r.rounds);
    let dmg = 0;
    let pierceExtra = 0;
    for (const e of all.flatMap((x) => x.events)) {
      dmg += e.damage;
      if (e.calc.pierce?.success) pierceExtra += (e.calc.pierce.extraDamage ?? 0) * (1 - e.calc.mitigation);
    }
    return {
      strategy,
      runs: rs.length,
      rounds: all.length,
      bossWinRate: all.filter((x) => x.winner === 'boss').length / all.length,
      roundOneBossWinRate: rs.filter((r) => r.rounds[0].winner === 'boss').length / rs.length,
      pierceDamageShare: dmg ? pierceExtra / dmg : 0,
    };
  });
}

/** How often each item was equipped (per round, per side). */
export function itemUsage(results: RunResult[]): Record<Side, Record<string, number>> {
  const out: Record<Side, Record<string, number>> = { player: {}, boss: {} };
  for (const rd of results.flatMap((r) => r.rounds)) {
    for (const [side, lo] of [['player', rd.playerLoadout], ['boss', rd.bossLoadout]] as const) {
      for (const id of [lo.hand1, lo.hand2, lo.armour]) if (id) out[side][id] = (out[side][id] ?? 0) + 1;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Weapon matrix
// ---------------------------------------------------------------------------------------------------------------

/** Level tiers matching the V2 economy (§3.3): about rounds 2–3, 4–5 and 8–10 of a run. */
export const TIERS = [
  { name: 'T1 early', level: 2, gold: 30, weaponMax: 15 },
  { name: 'T2 mid', level: 3, gold: 70, weaponMax: 30 },
  { name: 'T3 late', level: 5, gold: 140, weaponMax: 45 },
] as const;
export type Tier = (typeof TIERS)[number];

/** A weapon is judged in its own price bracket (cost range) at the matching tier. */
export function tierFor(item: Item): Tier {
  return item.cost <= TIERS[0].weaponMax ? TIERS[0] : item.cost <= TIERS[1].weaponMax ? TIERS[1] : TIERS[2];
}

function statsAt(level: number, alloc: Partial<Record<StatKey, number>>): Stats {
  const s: Stats = { ...BASE_STATS };
  for (const k of Object.keys(s) as StatKey[]) s[k] += LEVEL_UP_INCREASE[k] * (level - 1) + STAT_ALLOCATION_INCREASE[k] * (alloc[k] ?? 0);
  return s;
}
const pointsAt = (level: number) => INITIAL_STAT_POINTS + (level - 1);

function fighterSnap(side: Side, level: number, alloc: Partial<Record<StatKey, number>>, loadout: Loadout): FighterSnapshot {
  const stats = statsAt(level, alloc);
  return { side, level, stats, loadout, derived: deriveStats(stats, loadout) };
}

/** Allocation patterns for a points pool. */
function allocations(points: number): Partial<Record<StatKey, number>>[] {
  const half = Math.floor(points / 2);
  return [
    { str: points }, { dex: points }, { def: points }, { hp: points },
    { str: half, dex: points - half }, { str: half, hp: points - half }, { def: half, hp: points - half }, { dex: half, hp: points - half },
  ];
}

export type Archetype = 'turtle' | 'bruiser' | 'duelist' | 'archer' | 'knight';
export const ARCHETYPES: Archetype[] = ['turtle', 'bruiser', 'duelist', 'archer', 'knight'];

/** Opponent archetypes per tier: sensible, affordable gear and allocation (V2 catalogue ids). */
export function opponent(arch: Archetype, tier: Tier): FighterSnapshot {
  const P = pointsAt(tier.level);
  const h = Math.floor(P / 2);
  const t = TIERS.indexOf(tier);
  const gear: Record<Archetype, [Loadout, Partial<Record<StatKey, number>>]> = {
    turtle: [[
      { hand1: 'wooden_club', hand2: 'wood_shield', armour: 'leather_armour' },
      { hand1: 'iron_club', hand2: 'small_shield', armour: 'light_armour' },
      { hand1: 'mace', hand2: 'great_shield', armour: 'heavy_armour' },
    ][t], { def: h, hp: P - h }],
    bruiser: [[
      { hand1: 'iron_club', hand2: null, armour: 'leather_armour' },
      { hand1: 'mace', hand2: null, armour: 'light_armour' },
      { hand1: 'warhammer', hand2: null, armour: 'light_armour' },
    ][t], { str: P }],
    duelist: [[
      { hand1: 'knife', hand2: null, armour: 'leather_armour' },
      { hand1: 'sabre', hand2: null, armour: 'light_armour' },
      { hand1: 'rapier', hand2: null, armour: 'light_armour' },
    ][t], { dex: h, str: P - h }],
    archer: [[
      { hand1: 'bow', hand2: null, armour: 'leather_armour' },
      { hand1: 'crossbow', hand2: null, armour: 'light_armour' },
      { hand1: 'longbow', hand2: null, armour: 'light_armour' },
    ][t], { dex: P }],
    knight: [[
      { hand1: 'sword', hand2: 'wood_shield', armour: 'leather_armour' },
      { hand1: 'longsword', hand2: 'wood_shield', armour: 'light_armour' },
      { hand1: 'greatsword', hand2: 'small_shield', armour: 'light_armour' },
    ][t], { str: h, hp: P - h }],
  };
  const [lo, alloc] = gear[arch];
  return fighterSnap('player', tier.level, alloc, lo);
}

const scenarioOf = (opp: FighterSnapshot): Scenario => ({
  kind: opp.derived.rangedWeaponId ? 'ranged' : 'melee', snapshot: opp, preferredMode: opp.derived.attackModes[0], hypotheticalItems: [],
});

/**
 * ROBUST build for `weaponId` at a tier: the allocation × armour × shield (affordable with the weapon) with the best
 * MEAN analytic score against all five archetypes — a generic build, not a counter-pick of one opponent.
 */
export function robustBuildFor(weaponId: string, tier: Tier): FighterSnapshot {
  const w = requireItem(weaponId);
  const budget = tier.gold - w.cost;
  const armours = [null, ...ITEMS.filter((i) => i.category === 'armour' && i.cost <= budget).map((i) => i.id)];
  const shields = [null, ...ITEMS.filter((i) => i.category === 'shield' && i.cost <= budget).map((i) => i.id)];
  const scs = ARCHETYPES.map((a) => scenarioOf(opponent(a, tier)));
  let best: { snap: FighterSnapshot; score: number } | null = null;
  for (const armour of armours) {
    for (const shield of shields) {
      const cost = (armour ? requireItem(armour).cost : 0) + (shield ? requireItem(shield).cost : 0);
      if (cost > budget) continue;
      for (const alloc of allocations(pointsAt(tier.level))) {
        const snap = fighterSnap('boss', tier.level, alloc, { hand1: weaponId, hand2: shield, armour });
        const score = scs.reduce((sum, sc) => sum + analyticScore(snap, sc), 0) / scs.length;
        if (!best || score > best.score) best = { snap, score };
      }
    }
  }
  return best!.snap;
}

const prefer = (c: Parameters<Chooser>[0]) => ({ mode: c.options[0], source: 'agent' as const });

/**
 * Seeded MC duel of `me` (side 'boss') vs `opp` (side 'player').
 * margin per fight = my remaining HP fraction if I win, −(opponent's remaining HP fraction) if I lose → in [−1, 1].
 */
export function duel(me: FighterSnapshot, opp: FighterSnapshot, fights: number, seed: string): { winRate: number; margin: number } {
  let wins = 0;
  let margin = 0;
  for (let i = 0; i < fights; i++) {
    const { state } = runFullCombat({ ...opp, side: 'player' }, { ...me, side: 'boss' }, deriveSeed(seed, `f:${i}`), { player: prefer, boss: bossChooser });
    if (state.winner === 'boss') {
      wins++;
      margin += Math.max(0, state.hp.boss) / me.derived.maxHp;
    } else {
      margin -= Math.max(0, state.hp.player) / opp.derived.maxHp;
    }
  }
  return { winRate: wins / fights, margin: margin / fights };
}

export interface WeaponRow {
  weapon: string;
  cost: number;
  tier: string;
  pierce: string;
  build: string;
  /** Win rate vs each archetype opponent. */
  vs: Record<Archetype, number>;
  /** Mean HP margin vs the five archetypes. */
  archetypeMargin: number;
  /** Mean HP margin vs every other weapon's robust build at the same tier (round robin). */
  fieldMargin: number;
  /** Win rate in the round robin. */
  fieldWinRate: number;
}

const buildText = (s: FighterSnapshot) => {
  const lo = [s.loadout.hand2, s.loadout.armour].filter(Boolean).map((id) => requireItem(id!).name).join(' + ') || 'no shield/armour';
  const st = s.stats;
  return `${lo}; HP ${st.hp} STR ${st.str} DEF ${st.def} DEX ${st.dex}`;
};

const isWeapon = (i: Item) => i.category === 'melee' || i.category === 'ranged';
/** Weapons a fighter can afford at a tier (the "field"). */
export const fieldAt = (tier: Tier) => ITEMS.filter((i) => isWeapon(i) && i.cost <= tier.weaponMax);
/** The weapons that a tier newly unlocks (its price bracket) — what a weapon is judged against. */
export const bracketOf = (tier: Tier) => {
  const i = TIERS.indexOf(tier);
  const lo = i === 0 ? 0 : TIERS[i - 1].weaponMax;
  return ITEMS.filter((x) => isWeapon(x) && x.cost > lo && x.cost <= tier.weaponMax);
};
/** One number per weapon: mean of round-robin margin and archetype margin. */
export const combined = (r: WeaponRow) => (r.fieldMargin + r.archetypeMargin) / 2;

/** Row for one weapon at one tier against the archetypes and the given field builds. */
export function weaponRow(w: Item, tier: Tier, builds: Map<string, FighterSnapshot>, fights: number, seed: string): WeaponRow {
  const me = robustBuildFor(w.id, tier);
  const vs = {} as Record<Archetype, number>;
  let am = 0;
  for (const a of ARCHETYPES) {
    const r = duel(me, opponent(a, tier), fights, `${seed}:${tier.name}:${w.id}:${a}`);
    vs[a] = r.winRate;
    am += r.margin;
  }
  let fm = 0;
  let fw = 0;
  const others = [...builds.entries()].filter(([id]) => id !== w.id);
  for (const [id, b] of others) {
    const r = duel(me, b, fights, `${seed}:${tier.name}:${w.id}:rr:${id}`);
    fm += r.margin;
    fw += r.winRate;
  }
  return {
    weapon: w.id, cost: w.cost, tier: tier.name,
    pierce: w.pierce ? `${Math.round(w.pierce.chance * 100)}%/${Math.round(w.pierce.defIgnore * 100)}%` : '—',
    build: buildText(me), vs, archetypeMargin: am / ARCHETYPES.length,
    fieldMargin: others.length ? fm / others.length : 0, fieldWinRate: others.length ? fw / others.length : 0,
  };
}

/**
 * For each tier: every weapon affordable at that tier (cost ≤ tier.weaponMax) with its robust build,
 * vs the five archetypes and vs each other (round robin). Continuous margins avoid 0%/100% saturation.
 */
export function weaponMatrix(fights = 100, seed = 'balance', tiers: readonly Tier[] = TIERS): WeaponRow[] {
  const rows: WeaponRow[] = [];
  for (const tier of tiers) {
    const weapons = fieldAt(tier);
    const builds = new Map(weapons.map((w) => [w.id, robustBuildFor(w.id, tier)]));
    for (const w of weapons) rows.push(weaponRow(w, tier, builds, fights, seed));
  }
  return rows;
}

/** Rank of each weapon inside its tier by (fieldMargin + archetypeMargin)/2 — 1 = best. */
export function rankInTier(rows: WeaponRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of new Set(rows.map((r) => r.tier))) {
    const sorted = rows.filter((r) => r.tier === t).sort((a, b) => (b.fieldMargin + b.archetypeMargin) - (a.fieldMargin + a.archetypeMargin));
    sorted.forEach((r, i) => out.set(`${t}:${r.weapon}`, i + 1));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// 3. Pierce overrides (harness only)
// ---------------------------------------------------------------------------------------------------------------

export interface ItemOverride {
  cost?: number;
  mods?: Partial<Item['mods']>;
  pierce?: { chance: number; defIgnore: number };
}

/** Run `fn` with temporary item changes (proposal experiments). Restores the catalogue afterwards. */
export function withItems<T>(overrides: Record<string, ItemOverride>, fn: () => T): T {
  const saved = new Map<string, Item>();
  for (const [id, o] of Object.entries(overrides)) {
    const item = requireItem(id) as Item;
    saved.set(id, { ...item, mods: { ...item.mods }, pierce: item.pierce ? { ...item.pierce } : undefined });
    if (o.cost !== undefined) item.cost = o.cost;
    if (o.mods) item.mods = { ...item.mods, ...o.mods };
    if (o.pierce) item.pierce = { ...o.pierce, placeholder: false };
  }
  try {
    return fn();
  } finally {
    for (const [id, orig] of saved) Object.assign(requireItem(id) as Item, orig);
  }
}

/** Run `fn` with temporary pierce specs. Restores the catalogue afterwards (even on error). */
export function withPierce<T>(overrides: Record<string, { chance: number; defIgnore: number }>, fn: () => T): T {
  const saved = new Map<string, PierceSpec | undefined>();
  for (const [id, p] of Object.entries(overrides)) {
    const item = requireItem(id) as Item;
    saved.set(id, item.pierce);
    item.pierce = { chance: p.chance, defIgnore: p.defIgnore, placeholder: false };
  }
  try {
    return fn();
  } finally {
    for (const [id, p] of saved) (requireItem(id) as Item).pierce = p;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// 4. Pierce tuning (user-delegated, V2_DEMANDS §11.1 Q-5) — buff only
// ---------------------------------------------------------------------------------------------------------------

export interface TuneResult {
  weapon: string;
  tier: string;
  from: { chance: number; defIgnore: number };
  to: { chance: number; defIgnore: number };
  before: number;
  after: number;
  /** Non-pierce bracket peers' combined scores: median and best. */
  peerMedian: number;
  peerBest: number;
  target: number;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/**
 * Tune one pierce weapon in its own bracket. Goal: "a valid weapon and tactic, not the new best":
 * combined score at the midpoint between the bracket's non-pierce median and its non-pierce best.
 * Search: chance and DEF-ignore on a 5% grid, never below the current value (buff only), capped at
 * maxChance / maxIgnore. Picks the grid point closest to the target; ties → smaller total buff.
 */
export function tuneOne(weaponId: string, opts: { fights?: number; seed?: string; maxChance?: number; maxIgnore?: number } = {}): TuneResult {
  const fights = opts.fights ?? 60;
  const seed = opts.seed ?? 'tune';
  const w = requireItem(weaponId);
  const tier = tierFor(w);
  const from = { chance: w.pierce!.chance, defIgnore: w.pierce!.defIgnore };
  const field = fieldAt(tier);
  const builds = new Map(field.map((x) => [x.id, robustBuildFor(x.id, tier)]));
  const peers = bracketOf(tier).filter((x) => !x.pierce && x.id !== weaponId);
  const peerScores = peers.map((x) => combined(weaponRow(x, tier, builds, fights, seed)));
  const peerMedian = median(peerScores);
  const peerBest = Math.max(...peerScores);
  const target = (peerMedian + peerBest) / 2;
  const before = combined(weaponRow(w, tier, builds, fights, seed));

  const grid = (lo: number, hi: number) => {
    const out = [lo];
    for (let v = Math.ceil(lo * 20 + 1e-9) / 20; v <= hi + 1e-9; v += 0.05) if (v > lo + 1e-9) out.push(Math.round(v * 100) / 100);
    return out;
  };
  let best: { p: { chance: number; defIgnore: number }; score: number; dist: number; buff: number } | null = null;
  for (const chance of grid(from.chance, opts.maxChance ?? 0.6)) {
    for (const defIgnore of grid(from.defIgnore, opts.maxIgnore ?? 0.9)) {
      const p = { chance, defIgnore };
      const score = withPierce({ [weaponId]: p }, () => {
        const b2 = new Map(builds);
        b2.set(weaponId, robustBuildFor(weaponId, tier));
        return combined(weaponRow(w, tier, b2, fights, seed));
      });
      const dist = Math.abs(score - target);
      const buff = (chance - from.chance) + (defIgnore - from.defIgnore);
      if (!best || dist < best.dist - 0.01 || (Math.abs(dist - best.dist) <= 0.01 && buff < best.buff)) best = { p, score, dist, buff };
    }
  }
  return { weapon: weaponId, tier: tier.name, from, to: best!.p, before, after: best!.score, peerMedian, peerBest, target };
}
