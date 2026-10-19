/**
 * V3 MECHANICS LAB (Phase C1) — pure engine, NO database.
 *
 * Purpose: measure and tune the V3 mechanics (stun, dodge, block, counters, stims) on a VARIED population, not on a
 * handful of archetypes. For each game stage it generates hundreds of random-but-legal builds:
 *  - random stat-point spreads (from all-in on one stat to evenly spread),
 *  - random affordable gear in random hand shapes (melee, ranged, shield combos, hybrid, unarmed),
 *  - random supplies (no stims, a stim, slot/effectiveness upgrades) out of the same gold budget,
 * and gives each build a random PLAY STYLE: how it defends (smart / always block / always dodge / random / greedy),
 * when it heals (auto / only when low / never) and, for hybrids, how it picks Ranged vs Melee.
 *
 * Builds fight random opponents of the same stage. Builds, pairings and seeds are generated once and reused for every
 * rule variant, so variants are compared on identical fights (paired). Nothing here is a game rule.
 */
import { autoDefense, autoStim, runFullCombat, type Chooser, type CombatEvent, type CombatNote, type DefenseChooser, type StimChooser } from '../game/combat.js';
import { ITEMS_V3 } from '../game/catalog.js';
import { BASE_STATS, LEVEL_UP_INCREASE, STAT_ALLOCATION_INCREASE } from '../game/constants.js';
import { snapshotOf } from '../game/derive.js';
import { loadoutProblem } from '../game/equipment.js';
import { bestMode } from '../game/expected.js';
import { initialCombatant } from '../game/progression.js';
import { deriveSeed, Rng } from '../game/rng.js';
import type { RuleSet } from '../game/rules.js';
import type { FighterSnapshot, Item, ItemCategory, Loadout, Side, StatKey, Stats, Supplies } from '../game/types.js';
import { STAT_KEYS } from '../game/types.js';
import { wilson, type Interval } from './v3-baseline.js';

export interface LabStage { name: string; level: number; points: number; budget: number }

/**
 * Stages: level, stat points to spend, gold value of gear + supplies.
 * Early = round 1 with the new 10 starting gold. Mid/late budgets follow the V2 baseline economy
 * (a mid-run fighter has bought roughly 40–80 gold of gear, a late one 100–200).
 */
export const LAB_STAGES: LabStage[] = [
  { name: 'early', level: 1, points: 2, budget: 10 },
  { name: 'mid', level: 3, points: 4, budget: 60 },
  { name: 'late', level: 6, points: 7, budget: 140 },
];

export type DefenseStyle = 'smart' | 'block' | 'dodge' | 'random' | 'greedy';
export type StimStyle = 'auto' | 'low' | 'never';
export type ModeStyle = 'best' | 'melee' | 'ranged' | 'random';
export const DEFENSE_STYLES: DefenseStyle[] = ['smart', 'block', 'dodge', 'random', 'greedy'];

/** Stim economy used for build generation (owner: 10 g per stim; DEFAULT upgrade prices 25, 30, …). */
const STIM_COST = 10;
const UPGRADE_COST = (n: number) => 25 + 5 * n;

export interface LabBuild {
  id: number;
  stage: string;
  snap: FighterSnapshot;
  style: { defense: DefenseStyle; stim: StimStyle; mode: ModeStyle };
  shape: string;
  spent: number;
  allocation: Partial<Record<StatKey, number>>;
}

const items = (cat: ItemCategory) => ITEMS_V3.filter((i) => i.category === cat);

function randomAllocation(points: number, rng: Rng): Partial<Record<StatKey, number>> {
  // Weight_k = u^p: p near 0.5 → even spread, p up to 5 → focused on one stat.
  const p = 0.5 + rng.next() * 4.5;
  const w = STAT_KEYS.map(() => Math.pow(rng.next(), p));
  const total = w.reduce((a, c) => a + c, 0) || 1;
  const out: Partial<Record<StatKey, number>> = {};
  for (let i = 0; i < points; i++) {
    let r = rng.next() * total;
    let k = 0;
    while (k < 3 && r > w[k]) { r -= w[k]; k++; }
    out[STAT_KEYS[k]] = (out[STAT_KEYS[k]] ?? 0) + 1;
  }
  return out;
}

const SHAPES: { name: string; hands: ItemCategory[]; weight: number }[] = [
  { name: 'melee', hands: ['melee'], weight: 20 },
  { name: 'melee+shield', hands: ['melee', 'shield'], weight: 20 },
  { name: 'ranged', hands: ['ranged'], weight: 10 },
  { name: 'ranged+shield', hands: ['ranged', 'shield'], weight: 8 },
  { name: 'hybrid', hands: ['melee', 'ranged'], weight: 25 },
  { name: 'shield', hands: ['shield'], weight: 3 },
  { name: 'unarmed', hands: [], weight: 4 },
];

function pickWeighted<T extends { weight: number }>(xs: T[], rng: Rng): T {
  let r = rng.next() * xs.reduce((a, c) => a + c.weight, 0);
  for (const x of xs) { r -= x.weight; if (r <= 0) return x; }
  return xs[xs.length - 1];
}

export function randomBuild(id: number, stage: LabStage, rng: Rng): LabBuild {
  const allocation = randomAllocation(stage.points, rng);
  const stats: Stats = { ...BASE_STATS };
  for (const k of STAT_KEYS) stats[k] += LEVEL_UP_INCREASE[k] * (stage.level - 1) + STAT_ALLOCATION_INCREASE[k] * (allocation[k] ?? 0);

  // Supplies plan first (reserves gold): none / one stim / upgrades then stims.
  let budget = stage.budget;
  const supplies: Supplies = { stims: 0, slots: 1, effectiveness: 0 };
  const plan = rng.next();
  if (plan > 0.4 && budget >= STIM_COST) {
    if (plan > 0.8) {
      let n = 0;
      while (budget - UPGRADE_COST(n) >= STIM_COST * 2 && rng.next() < 0.6) {
        budget -= UPGRADE_COST(n);
        if (rng.next() < 0.5) supplies.slots++;
        else supplies.effectiveness++;
        n++;
      }
    }
    const want = 1 + rng.int(supplies.slots);
    while (supplies.stims < want && budget >= STIM_COST && rng.next() < 0.9) { budget -= STIM_COST; supplies.stims++; }
  }

  // Gear: a random hand shape, slots filled in random order with a random affordable item.
  const shape = pickWeighted(SHAPES, rng);
  const slots: ItemCategory[] = [...shape.hands];
  if (rng.next() < 0.6) slots.push('armour');
  for (let i = slots.length - 1; i > 0; i--) { const j = rng.int(i + 1); [slots[i], slots[j]] = [slots[j], slots[i]]; }
  const chosen: Item[] = [];
  for (const cat of slots) {
    const ok = items(cat).filter((it) => it.cost <= budget);
    if (!ok.length) continue;
    const it = rng.pick(ok);
    chosen.push(it);
    budget -= it.cost;
  }
  const hands = chosen.filter((i) => i.category !== 'armour');
  const loadout: Loadout = { hand1: hands[0]?.id ?? null, hand2: hands[1]?.id ?? null, armour: chosen.find((i) => i.category === 'armour')?.id ?? null };
  const inventory = chosen.map((i) => i.id);
  const problem = loadoutProblem(loadout, inventory);
  if (problem) throw new Error(`lab built an illegal loadout: ${problem}`);
  const base = initialCombatant('player');
  const snap: FighterSnapshot = { ...snapshotOf({ ...base, stats, inventory, loadout }), supplies };
  const defense = DEFENSE_STYLES[rng.int(DEFENSE_STYLES.length)];
  const stim: StimStyle = (['auto', 'low', 'never'] as const)[rng.int(3)];
  const mode: ModeStyle = (['best', 'best', 'melee', 'ranged', 'random'] as const)[rng.int(5)];
  return { id, stage: stage.name, snap, style: { defense, stim, mode }, shape: shape.name, spent: stage.budget - budget, allocation };
}

// ---------- play styles as choosers ----------

function defenseChooser(style: DefenseStyle, rng: Rng, rules: RuleSet): DefenseChooser {
  switch (style) {
    case 'block': return () => ({ action: 'block', source: 'agent' });
    case 'dodge': return () => ({ action: 'dodge', source: 'agent' });
    case 'random': return () => ({ action: rng.next() < 0.5 ? 'block' : 'dodge', source: 'agent' });
    case 'greedy': return autoDefense;
    case 'smart': return ({ odds }) => {
      // Value of a successful defence: the hit avoided, plus the counter's expected worth; a blocked heavy hit still stuns.
      const c = rules.v3!.counter;
      const blockV = odds.block.chance * (1 + (odds.block.counterPossible ? Math.min(c.blockChanceCap, odds.expectedShaved) * c.blockMultiplier * 0.5 : 0) - (odds.block.heavy ? 0.15 : 0));
      const dodgeV = odds.dodge.chance * (1 + odds.dodge.counterChance * c.dodgeMultiplier * 0.5);
      return { action: dodgeV > blockV ? 'dodge' : 'block', source: 'agent' };
    };
  }
}

function stimChooser(style: StimStyle): StimChooser {
  if (style === 'auto') return autoStim;
  if (style === 'never') return () => ({ use: false, source: 'agent' });
  return ({ view, side }) => ({ use: view.hp[side] < 0.5 * view.fighters[side].derived.maxHp, source: 'agent' });
}

function modeChooser(style: ModeStyle, rng: Rng): Chooser {
  return (ctx) => {
    const att = ctx.view.fighters[ctx.side];
    const def = ctx.view.fighters[ctx.side === 'player' ? 'boss' : 'player'];
    if (style === 'best') return { mode: bestMode(att, def, ctx.options).mode, source: 'agent' };
    if (style === 'random') return { mode: rng.pick(ctx.options), source: 'agent' };
    return { mode: ctx.options.includes(style) ? style : ctx.options[0], source: 'agent' };
  };
}

// ---------- population + pairings ----------

export interface LabPopulation { stage: LabStage; builds: LabBuild[]; pairs: { a: number; b: number; seed: number }[] }

export function makePopulation(stage: LabStage, nBuilds: number, nFights: number, seed: string): LabPopulation {
  const rng = new Rng(deriveSeed(seed, `pop:${stage.name}`));
  const builds = Array.from({ length: nBuilds }, (_, i) => randomBuild(i, stage, rng));
  const pairs = Array.from({ length: nFights }, (_, k) => {
    const a = rng.int(nBuilds);
    let b = rng.int(nBuilds - 1);
    if (b >= a) b++;
    return { a, b, seed: deriveSeed(seed, `${stage.name}:fight:${k}`) };
  });
  return { stage, builds, pairs };
}

// ---------- metrics ----------

const canStunWeapon = (b: LabBuild) => !!(b.snap.derived.meleeWeaponId && ITEMS_V3.find((i) => i.id === b.snap.derived.meleeWeaponId)!.combat?.canStun);
const dodgeCounterWeapon = (b: LabBuild) => !!(b.snap.derived.meleeWeaponId && ITEMS_V3.find((i) => i.id === b.snap.derived.meleeWeaponId)!.combat?.dodgeCounter);
const hasShield = (b: LabBuild) => [b.snap.loadout.hand1, b.snap.loadout.hand2].some((id) => id && ITEMS_V3.find((i) => i.id === id)!.category === 'shield');

export interface LabMetrics {
  rules: string;
  stage: string;
  fights: number;
  attacksPerFight: number;
  stalls: number;
  // stun
  stunsPerFight: number;
  /** Fights with a can-stun weapon on either side in which that holder stunned its opponent at least once. */
  stunHolderLandsStun: Interval;
  stunExtraDamageShare: number;
  /** Among fights with a can-stun weapon: share where one fighter was stunned 2+ times. */
  stunChainShare: Interval;
  skipsPerFight: number;
  /** How decisive a stun is: win rate of a can-stun holder in fights where it landed ≥1 stun, and where it landed none. */
  stunnerWinWhenLanded: Interval;
  stunnerWinWhenNot: Interval;
  // defence
  blockRate: Interval;
  dodgeRate: Interval;
  /** Share of the defences chosen by 'smart' fighters that were dodges. */
  smartDodgeShare: number;
  counterDamageShare: number;
  countersPerFight: number;
  // stims
  stimsPerFight: number;
  healShareOfDamage: number;
  // who wins (pair level; ties in the feature excluded)
  fasterWins: Interval;
  strongerWins: Interval;
  tougherWins: Interval;
  /** Win rate vs the population by group (appearances). */
  groups: Record<string, Interval>;
}

interface Tally { w: number; n: number }
const add = (t: Record<string, Tally>, k: string, won: boolean) => { const x = (t[k] ??= { w: 0, n: 0 }); x.n++; if (won) x.w++; };

export function runLab(pop: LabPopulation, rules: RuleSet): LabMetrics {
  let attacks = 0, stalls = 0, stuns = 0, stunExtra = 0, damage = 0, skips = 0, counters = 0, counterDmg = 0, stims = 0, heal = 0;
  let blockTry = 0, blockOk = 0, dodgeTry = 0, dodgeOk = 0, smartBlock = 0, smartDodge = 0;
  let stunFights = 0, stunLanded = 0, stunFightSides = 0, chainFights = 0;
  const landedWin = { w: 0, n: 0 }, notLandedWin = { w: 0, n: 0 };
  const pairWin = { faster: { w: 0, n: 0 }, stronger: { w: 0, n: 0 }, tougher: { w: 0, n: 0 } };
  const groups: Record<string, Tally> = {};

  for (const { a, b, seed } of pop.pairs) {
    const A = pop.builds[a], B = pop.builds[b];
    const r = new Rng(seed ^ 0x5bd1e995);
    const pSnap = { ...A.snap, side: 'player' as Side };
    const bSnap = { ...B.snap, side: 'boss' as Side };
    let res: { state: { winner: Side | null }; events: CombatEvent[]; notes: CombatNote[] };
    try {
      res = runFullCombat(pSnap, bSnap, seed, { player: modeChooser(A.style.mode, r), boss: modeChooser(B.style.mode, r) }, {
        rules,
        defense: { player: defenseChooser(A.style.defense, r, rules), boss: defenseChooser(B.style.defense, r, rules) },
        stim: { player: stimChooser(A.style.stim), boss: stimChooser(B.style.stim) },
      });
    } catch {
      stalls++;
      continue;
    }
    const winner = res.state.winner!;
    const sides: [LabBuild, Side][] = [[A, 'player'], [B, 'boss']];
    const stunnedCount: Record<Side, number> = { player: 0, boss: 0 };
    const stunsBy: Record<Side, number> = { player: 0, boss: 0 };
    for (const e of res.events) {
      damage += e.damage;
      if (e.kind === 'counter') { counters++; counterDmg += e.damage; }
      else attacks++;
      if (e.stun?.triggered) {
        stuns++;
        stunExtra += e.stun.triggered.extraDamage;
        stunnedCount[e.stun.triggered.target]++;
        stunsBy[e.stun.triggered.target === 'player' ? 'boss' : 'player']++;
      }
      const d = e.defense;
      if (d && d.action !== 'none') {
        const style = (e.defender === 'player' ? A : B).style.defense;
        if (d.action === 'block') { blockTry++; if (d.success) blockOk++; if (style === 'smart') smartBlock++; }
        else { dodgeTry++; if (d.success) dodgeOk++; if (style === 'smart') smartDodge++; }
      }
    }
    for (const n of res.notes) {
      if (n.kind === 'skip') skips++;
      if (n.kind === 'stim') { stims++; heal += n.detail.heal ?? 0; }
    }
    const anyStun = canStunWeapon(A) || canStunWeapon(B);
    if (anyStun) {
      stunFights++;
      if (stunnedCount.player >= 2 || stunnedCount.boss >= 2) chainFights++;
      for (const [bld, side] of sides) if (canStunWeapon(bld)) {
        stunFightSides++;
        const t = stunsBy[side] > 0 ? landedWin : notLandedWin;
        if (stunsBy[side] > 0) stunLanded++;
        t.n++;
        if (winner === side) t.w++;
      }
    }
    // pair-level "who wins" by derived stats
    const cmp = (k: 'effDex' | 'netAtk' | 'netDef', t: Tally) => {
      const x = A.snap.derived[k], y = B.snap.derived[k];
      if (x === y) return;
      t.n++;
      if ((x > y) === (winner === 'player')) t.w++;
    };
    cmp('effDex', pairWin.faster); cmp('netAtk', pairWin.stronger); cmp('netDef', pairWin.tougher);
    for (const [bld, side] of sides) {
      const won = winner === side;
      add(groups, `style:${bld.style.defense}`, won);
      add(groups, `stim:${bld.style.stim}`, won);
      add(groups, `shape:${bld.shape}`, won);
      if (canStunWeapon(bld)) add(groups, 'gear:can-stun weapon', won);
      if (dodgeCounterWeapon(bld)) add(groups, 'gear:dodge-counter weapon', won);
      if (hasShield(bld)) add(groups, 'gear:shield', won);
      if (bld.snap.loadout.armour === 'heavy_armour') add(groups, 'gear:heavy armour', won);
      if (bld.snap.supplies!.stims > 0) add(groups, 'supplies:has stims', won);
      add(groups, `dex-alloc:${(bld.allocation.dex ?? 0) >= Math.ceil(pop.stage.points / 2) ? 'heavy' : 'light'}`, won);
      add(groups, `def-alloc:${(bld.allocation.def ?? 0) >= Math.ceil(pop.stage.points / 2) ? 'heavy' : 'light'}`, won);
    }
  }
  const n = pop.pairs.length - stalls;
  const iv = (t: Tally) => wilson(t.w, t.n);
  return {
    rules: rules.id,
    stage: pop.stage.name,
    fights: n,
    attacksPerFight: attacks / n,
    stalls,
    stunsPerFight: stuns / n,
    stunHolderLandsStun: wilson(stunLanded, stunFightSides),
    stunExtraDamageShare: damage ? stunExtra / damage : 0,
    stunChainShare: wilson(chainFights, stunFights),
    skipsPerFight: skips / n,
    stunnerWinWhenLanded: iv(landedWin),
    stunnerWinWhenNot: iv(notLandedWin),
    blockRate: wilson(blockOk, blockTry),
    dodgeRate: wilson(dodgeOk, dodgeTry),
    smartDodgeShare: smartBlock + smartDodge ? smartDodge / (smartBlock + smartDodge) : NaN,
    counterDamageShare: damage ? counterDmg / damage : 0,
    countersPerFight: counters / n,
    stimsPerFight: stims / n,
    healShareOfDamage: damage ? heal / damage : 0,
    fasterWins: iv(pairWin.faster),
    strongerWins: iv(pairWin.stronger),
    tougherWins: iv(pairWin.tougher),
    groups: Object.fromEntries(Object.entries(groups).sort().map(([k, t]) => [k, iv(t)])),
  };
}
