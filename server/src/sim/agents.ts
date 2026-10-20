/**
 * SIMULATED PLAYER AGENTS.
 *
 * An agent stands in for the human player in automated runs. Before each round it returns a
 * decision (stat allocations, purchases, loadout) which the runner applies through the SAME validated
 * services the web API uses (services/runs.ts → game/equipment.ts). During combat it answers
 * Ranged-vs-Melee choices through a Chooser, exactly like the human's choice prompt.
 *
 * Every agent spends ALL available stat points each round (including the 2 initial points before round 1),
 * which satisfies the round-1 rule enforced by services/rounds.ts.
 * Agents only use information a human player would have: their own state, the round number and the
 * outcomes of previous rounds. They never see the boss's upcoming decision.
 *
 * Strategies are deliberately different so the ML dataset covers several behaviours (see docs/SIMULATIONS.md):
 *   melee_bruiser  – STR/HP, melee weapons + armour, never ranged
 *   archer         – DEX, Bow → Crossbow, attacks ranged as soon as it owns a bow
 *   shield_turtle  – DEF/HP, melee + shield + armour
 *   hybrid         – Bow + melee weapon, picks the higher-expected-damage mode each attack
 *   adaptive       – starts melee, switches style (melee → ranged → pierce → …) after two consecutive losses
 *   piercer        – STR/HP, pierce weapons (Spear → Lance/Flail → Pike) + shield, armour-breaking melee
 *   duelist        – DEX/STR, fast blades (Knife → Sabre → Rapier) + armour
 *   opportunist    – melee; goes ranged after a loss when a bow is affordable, back to melee after two wins
 *   switcher       – flips melee ↔ ranged with 35% probability each round (seeded)
 *   reactive       – randomised per-run persona; style evolves from observed results and the boss's visible gear
 *   random         – random legal allocations, purchases, loadouts and mode choices (exploration/noise)
 */
import { getItem, ITEMS, requireItem } from '../game/catalog.js';
import type { Chooser } from '../game/combat.js';
import { isLegalLoadout } from '../game/equipment.js';
import { bestMode } from '../game/expected.js';
import { hashSeed, Rng } from '../game/rng.js';
import type { AttackMode, CombatantState, ItemCategory, Loadout, Side, StatKey } from '../game/types.js';
import { STAT_KEYS } from '../game/types.js';
import { V4_AGENTS } from './agents-v4.js';

/**
 * Bump when agent behaviour or the meaning of simulated records changes, so data can be traced to the code that produced it.
 *  sim-1.0.0 — engine 1.0.0 (no initial stat points).
 *  sim-1.1.0 — engine 1.1.0: agents spend the 2 initial stat points before round 1 with their normal allocation pattern.
 *  sim-2.0.0 — engine 2.0.0: V2 catalogue wishlists; new `piercer` and `duelist` agents; adaptive cycles 3 styles.
 *  sim-2.1.0 — adds style-switching `opportunist` and `switcher` agents (existing agents unchanged).
 *  sim-2.2.0 — adds the randomised, conditional `reactive` agent; agents also observe the boss's last gear and their HP left.
 *  sim-3.0.0 — engine 3.0.0: agents defend with their V3 persona (sim/v3-policies.ts AGENT_DEFENSE), heal with the
 *              automatic stim rule and spend leftover gold on stims (game/supply-plan.ts). Build logic unchanged.
 *  sim-3.1.0 — V3 Phase D: adds one champion per V3 mechanic — `blocker`, `dodger`, `stunner`, `healer`,
 *              `counter_puncher` (existing agents unchanged).
 *  sim-4.0.0 — V4 next-build data: five varied, reactive families with per-run personas in sim/agents-v4.ts —
 *              `saver`, `armourer`, `counter_builder`, `explorer`, `splitter` (existing agents unchanged).
 */
export const SIMULATOR_VERSION = 'sim-4.0.0';

/** What the player saw of a finished round (all visible in the round view: result, the boss's gear, own HP left). */
export interface RoundOutcome {
  roundNumber: number;
  winner: Side;
  bossLoadout?: Loadout;
  playerHpEndFrac?: number;
}

export interface AgentContext {
  roundNumber: number;
  state: CombatantState;
  history: RoundOutcome[];
  rng: Rng;
  /** The run's seed — lets an agent fix a per-run "persona" (randomised parameters) reproducibly. */
  runSeed?: string;
}

export interface AgentDecision {
  allocations: { stat: StatKey; points: number }[];
  purchases: string[];
  loadout: Loadout;
  note: string;
}

export interface Agent {
  name: string;
  description: string;
  decide(ctx: AgentContext): AgentDecision;
  /** In-combat chooser for fighters holding Ranged + Melee. The rng is seeded per round. */
  chooser(rng: Rng): Chooser;
}

const EMPTY: Loadout = { hand1: null, hand2: null, armour: null };

/** Item "power" used to pick the best owned item of a category — a simple, documented heuristic. */
type Weights = { str: number; def: number; dex: number; pierce?: number; dodgeCounter?: number; block?: number };

function itemScore(id: string, weights: Weights): number {
  const it = requireItem(id);
  const m = it.mods;
  const pierceEv = it.pierce ? it.pierce.chance * it.pierce.defIgnore : 0;
  const c = it.combat ?? {};
  return m.str * weights.str + m.def * weights.def + m.dex * weights.dex + pierceEv * (weights.pierce ?? 0)
    + (c.dodgeCounter ?? 0) * (weights.dodgeCounter ?? 0) + (c.blockBonus ?? 0) * (weights.block ?? 0);
}

function bestOwned(inv: string[], cat: ItemCategory, w: Weights = { str: 1, def: 1, dex: 1 }): string | null {
  const owned = inv.filter((id) => requireItem(id).category === cat);
  if (!owned.length) return null;
  return owned.reduce((a, b) => (itemScore(b, w) > itemScore(a, w) ? b : a));
}

/**
 * Build a loadout from wanted hand categories (in priority order) + armour, using the best owned item
 * of each category. Falls back to fewer items if a combination would be illegal.
 */
function loadoutFrom(inv: string[], hands: ItemCategory[], wantArmour: boolean, w: Weights = { str: 1, def: 1, dex: 1 }): Loadout {
  const picked = hands.map((c) => bestOwned(inv, c, w)).filter((x): x is string => x !== null).slice(0, 2);
  const lo: Loadout = { hand1: picked[0] ?? null, hand2: picked[1] ?? null, armour: wantArmour ? bestOwned(inv, 'armour') : null };
  if (isLegalLoadout(lo, inv)) return lo;
  const single: Loadout = { ...lo, hand2: null };
  return isLegalLoadout(single, inv) ? single : EMPTY;
}

/** Buy wishlist items strictly in order while affordable (saving up for the next one otherwise). */
function buyInOrder(state: CombatantState, wishlist: string[]): string[] {
  let gold = state.gold;
  const owned = new Set(state.inventory);
  const out: string[] = [];
  for (const id of wishlist) {
    if (owned.has(id)) continue;
    const cost = requireItem(id).cost;
    if (cost > gold) break;
    gold -= cost;
    owned.add(id);
    out.push(id);
  }
  return out;
}

/** Spend all stat points by cycling through a priority pattern (deterministic for a given level). */
function allocateByPattern(state: CombatantState, pattern: StatKey[]): { stat: StatKey; points: number }[] {
  const counts: Partial<Record<StatKey, number>> = {};
  for (let i = 0; i < state.statPoints; i++) {
    const stat = pattern[(state.level + i) % pattern.length];
    counts[stat] = (counts[stat] ?? 0) + 1;
  }
  return Object.entries(counts).map(([stat, points]) => ({ stat: stat as StatKey, points: points! }));
}

const preferChooser = (pref: AttackMode): Chooser => (ctx) => ({
  mode: ctx.options.includes(pref) ? pref : ctx.options[0],
  source: 'agent',
  reason: `Agent prefers ${pref}`,
});

const expectedDamageChooser: Chooser = (ctx) => {
  const att = ctx.view.fighters[ctx.side];
  const def = ctx.view.fighters[ctx.side === 'player' ? 'boss' : 'player'];
  const { mode, expected } = bestMode(att, def, ctx.options);
  return { mode, source: 'agent', reason: `Higher expected damage (${Object.entries(expected).map(([m, v]) => `${m} ${v.toFixed(2)}`).join(' vs ')})` };
};

const after = (state: CombatantState, purchases: string[]) => [...state.inventory, ...purchases];

export const meleeBruiser: Agent = {
  name: 'melee_bruiser',
  description: 'Allocates STR/HP; buys Knuckle → Sword → LongSword → Warhammer plus armour; always melee.',
  decide({ state }) {
    const purchases = buyInOrder(state, ['knuckle', 'sword', 'leather_armour', 'longsword', 'warhammer', 'light_armour', 'heavy_armour']);
    return {
      allocations: allocateByPattern(state, ['str', 'str', 'hp']),
      purchases,
      loadout: loadoutFrom(after(state, purchases), ['melee'], true, { str: 1, def: 0.3, dex: 0.1 }),
      note: 'heavy melee build',
    };
  },
  chooser: () => preferChooser('melee'),
};

export const archer: Agent = {
  name: 'archer',
  description: 'Allocates DEX; buys Bow → Leather Armor → Crossbow → Longbow; attacks ranged once it owns a bow.',
  decide({ state }) {
    const purchases = buyInOrder(state, ['bow', 'leather_armour', 'crossbow', 'longbow']);
    return {
      allocations: allocateByPattern(state, ['dex', 'dex', 'hp']),
      purchases,
      loadout: loadoutFrom(after(state, purchases), ['ranged'], true, { str: 0, def: 0.2, dex: 1 }),
      note: 'ranged build',
    };
  },
  chooser: () => preferChooser('ranged'),
};

export const shieldTurtle: Agent = {
  name: 'shield_turtle',
  description: 'Allocates DEF/HP; buys Knuckle, shields and armour; melee + shield.',
  decide({ state }) {
    const purchases = buyInOrder(state, ['knuckle', 'wood_shield', 'leather_armour', 'sword', 'small_shield', 'light_armour', 'great_shield', 'heavy_armour']);
    return {
      allocations: allocateByPattern(state, ['def', 'hp', 'def', 'str']),
      purchases,
      loadout: loadoutFrom(after(state, purchases), ['melee', 'shield'], true, { str: 0.5, def: 1, dex: 0.2 }),
      note: 'defensive build',
    };
  },
  chooser: () => preferChooser('melee'),
};

export const hybrid: Agent = {
  name: 'hybrid',
  description: 'Bow + melee weapon; alternates DEX/STR; picks whichever mode has higher expected damage.',
  decide({ state }) {
    const purchases = buyInOrder(state, ['knuckle', 'bow', 'sword', 'leather_armour', 'crossbow', 'sabre', 'rapier']);
    return {
      allocations: allocateByPattern(state, ['dex', 'str', 'hp']),
      purchases,
      loadout: loadoutFrom(after(state, purchases), ['ranged', 'melee'], true),
      note: 'ranged + melee flexibility',
    };
  },
  chooser: () => expectedDamageChooser,
};

export type AdaptiveStyle = 'melee' | 'ranged' | 'pierce';
const STYLE_CYCLE: AdaptiveStyle[] = ['melee', 'ranged', 'pierce'];

/** Current style of the adaptive agent = derived from history, so it is reproducible without hidden state. */
export function adaptiveStyle(history: RoundOutcome[]): AdaptiveStyle {
  let i = 0;
  let streak = 0;
  for (const h of history) {
    streak = h.winner === 'boss' ? streak + 1 : 0;
    if (streak >= 2) {
      i = (i + 1) % STYLE_CYCLE.length;
      streak = 0;
    }
  }
  return STYLE_CYCLE[i];
}

export const adaptive: Agent = {
  name: 'adaptive',
  description: 'Starts melee; after two consecutive losses switches style (melee → ranged → pierce) and re-gears.',
  decide({ state, history }) {
    const style = adaptiveStyle(history);
    const wishlist = style === 'ranged'
      ? ['bow', 'leather_armour', 'crossbow', 'longbow']
      : style === 'pierce'
        ? ['spear', 'leather_armour', 'lance', 'pike']
        : ['knuckle', 'sword', 'leather_armour', 'mace', 'greatsword'];
    const purchases = buyInOrder(state, wishlist);
    const inv = after(state, purchases);
    const hasPierceMelee = inv.some((id) => requireItem(id).category === 'melee' && requireItem(id).pierce);
    const loadout = style === 'ranged' && bestOwned(inv, 'ranged')
      ? loadoutFrom(inv, ['ranged'], true, { str: 0, def: 0.2, dex: 1 })
      : style === 'pierce' && hasPierceMelee
        ? loadoutFrom(inv, ['melee'], true, PIERCE_WEIGHTS)
        : loadoutFrom(inv, ['melee'], true, { str: 1, def: 0.3, dex: 0.1 });
    return {
      allocations: allocateByPattern(state, style === 'ranged' ? ['dex', 'hp'] : ['str', 'hp']),
      purchases,
      loadout,
      note: `style=${style}`,
    };
  },
  chooser: () => expectedDamageChooser,
};

/** Weights that make loadoutFrom prefer pierce weapons (pierce EV = chance × DEF-ignore counts heavily). */
const PIERCE_WEIGHTS: Weights = { str: 0.4, def: 0.1, dex: 0.1, pierce: 40 };

export const piercer: Agent = {
  name: 'piercer',
  description: 'Allocates STR/HP/STR; buys Spear → Leather Armor → Wood Shield → Lance → Flail → Pike; armour-breaking melee.',
  decide({ state }) {
    const purchases = buyInOrder(state, ['spear', 'leather_armour', 'wood_shield', 'lance', 'flail', 'pike']);
    return {
      allocations: allocateByPattern(state, ['str', 'hp', 'str']),
      purchases,
      loadout: loadoutFrom(after(state, purchases), ['melee', 'shield'], true, PIERCE_WEIGHTS),
      note: 'pierce melee build',
    };
  },
  chooser: () => preferChooser('melee'),
};

export const duelist: Agent = {
  name: 'duelist',
  description: 'Allocates DEX/STR; buys Knife → Leather Armor → Sabre → Rapier → Light Armor; fast blade that strikes first.',
  decide({ state }) {
    const purchases = buyInOrder(state, ['knife', 'leather_armour', 'sabre', 'rapier', 'light_armour']);
    return {
      allocations: allocateByPattern(state, ['dex', 'str', 'dex']),
      purchases,
      loadout: loadoutFrom(after(state, purchases), ['melee'], true, { str: 0.6, def: 0.2, dex: 1, pierce: 20 }),
      note: 'DEX duelist build',
    };
  },
  chooser: () => preferChooser('melee'),
};

// --- V3 mechanic champions (sim-3.1.0) ------------------------------------------------------------------------------
// One agent per V3 mechanic, so every mechanic has a dedicated player in the benchmark: if its champion has no path to
// winning rounds, the mechanic is decoration. Their defence persona is in sim/v3-policies.ts AGENT_DEFENSE.

export const blocker: Agent = {
  name: 'blocker',
  description: 'V3: allocates DEF/HP/DEF; buys Wood Shield → Leather Armor → Sword → Small Shield → Light Armor → LongSword; always blocks.',
  decide({ state }) {
    const purchases = buyInOrder(state, ['wood_shield', 'leather_armour', 'sword', 'small_shield', 'light_armour', 'longsword']);
    return {
      allocations: allocateByPattern(state, ['def', 'hp', 'def']),
      purchases,
      loadout: loadoutFrom(after(state, purchases), ['melee', 'shield'], true, { str: 1, def: 1, dex: 0.3, block: 40 }),
      note: 'V3 block wall',
    };
  },
  chooser: () => preferChooser('melee'),
};

export const dodger: Agent = {
  name: 'dodger',
  description: 'V3: allocates DEX/DEX/HP; buys Spear → Leather Armor → Lance → Pike; no shield (DEX penalties); always dodges, counters with long weapons.',
  decide({ state }) {
    const purchases = buyInOrder(state, ['spear', 'leather_armour', 'lance', 'pike']);
    return {
      allocations: allocateByPattern(state, ['dex', 'dex', 'hp']),
      purchases,
      loadout: loadoutFrom(after(state, purchases), ['melee'], true, { str: 0.5, def: 0.2, dex: 1, dodgeCounter: 30 }),
      note: 'V3 dodge + dodge counter',
    };
  },
  chooser: () => preferChooser('melee'),
};

export const stunner: Agent = {
  name: 'stunner',
  description: 'V3: allocates STR/HP/STR; buys Iron Club → Leather Armor → Mace → Warhammer; can-stun blunt weapons.',
  decide({ state }) {
    const purchases = buyInOrder(state, ['iron_club', 'leather_armour', 'mace', 'warhammer']);
    return {
      allocations: allocateByPattern(state, ['str', 'hp', 'str']),
      purchases,
      loadout: loadoutFrom(after(state, purchases), ['melee'], true, { str: 1, def: 0.3, dex: 0.1 }),
      note: 'V3 stun pressure',
    };
  },
  chooser: () => preferChooser('melee'),
};

export const healer: Agent = {
  name: 'healer',
  description: 'V3: allocates HP/DEF/STR; buys Sword → Leather Armor → LongSword only; spends the rest on stims and stim upgrades (no savings reserve).',
  decide({ state }) {
    const purchases = buyInOrder(state, ['sword', 'leather_armour', 'longsword']);
    return {
      allocations: allocateByPattern(state, ['hp', 'def', 'str']),
      purchases,
      loadout: loadoutFrom(after(state, purchases), ['melee'], true),
      note: 'V3 sustain',
    };
  },
  chooser: () => preferChooser('melee'),
};

export const counterPuncher: Agent = {
  name: 'counter_puncher',
  description: 'V3: allocates STR/DEF/STR; buys Sword → Small Shield → LongSword → Leather Armor; blocks every attack to land ×1.5 block counters.',
  decide({ state }) {
    const purchases = buyInOrder(state, ['sword', 'small_shield', 'longsword', 'leather_armour']);
    return {
      allocations: allocateByPattern(state, ['str', 'def', 'str']),
      purchases,
      loadout: loadoutFrom(after(state, purchases), ['melee', 'shield'], true, { str: 1, def: 0.5, dex: 0.2, block: 20 }),
      note: 'V3 counter-puncher',
    };
  },
  chooser: () => preferChooser('melee'),
};

// --- Style-switching agents (sim-2.1.0) ---------------------------------------------------------------------------
// Fixed-style agents only teach a model "which agent is this" (V2 model s3 failed leave-one-strategy-out). These two
// change style for reasons visible in the features (losses, gold, what they own) or at random, so the data contains
// real decisions to switch — the thing the transparent baseline cannot predict.

const RANGED_WISHLIST = ['bow', 'leather_armour', 'crossbow', 'longbow'];
const MELEE_WISHLIST = ['knuckle', 'sword', 'leather_armour', 'longsword', 'mace'];

const ownsRanged = (s: CombatantState) => s.inventory.some((id) => requireItem(id).category === 'ranged');
const usedRanged = (s: CombatantState) => [s.loadout.hand1, s.loadout.hand2].some((id) => id !== null && requireItem(id).category === 'ranged');
const canFieldRanged = (s: CombatantState) => ownsRanged(s) || s.gold >= Math.min(...ITEMS.filter((i) => i.category === 'ranged').map((i) => i.cost));

/** Build the round's decision for a chosen style (falls back to melee when ranged is not affordable). */
function styledDecision(
  state: CombatantState, wanted: 'melee' | 'ranged', note: string,
  opts: { meleeWishlist?: string[]; meleePattern?: StatKey[]; rangedPattern?: StatKey[] } = {},
): AgentDecision {
  const style = wanted === 'ranged' && canFieldRanged(state) ? 'ranged' : 'melee';
  const purchases = buyInOrder(state, style === 'ranged' ? RANGED_WISHLIST : (opts.meleeWishlist ?? MELEE_WISHLIST));
  const inv = after(state, purchases);
  const loadout = style === 'ranged' && bestOwned(inv, 'ranged')
    ? loadoutFrom(inv, ['ranged'], true, { str: 0, def: 0.2, dex: 1 })
    : loadoutFrom(inv, ['melee'], true, { str: 1, def: 0.3, dex: 0.1, pierce: 20 });
  const pattern = style === 'ranged' ? (opts.rangedPattern ?? ['dex', 'hp']) : (opts.meleePattern ?? ['str', 'hp']);
  return { allocations: allocateByPattern(state, pattern), purchases, loadout, note: `${note}; style=${style}` };
}

/** Per-run persona of the `reactive` agent: every parameter is drawn once from the run seed. */
export interface ReactivePersona {
  start: 'melee' | 'ranged';
  /** Consecutive losses after which it changes style (99 = never). */
  lossesToSwitch: number;
  /** Probability of answering the boss's last visible gear (boss had a bow → close in with melee; boss was a slow
   *  heavy fighter, Eff. DEX ≤ 5 is not visible, so: boss carried a shield or heavy armour → go ranged). */
  counterBoss: number;
  /** Probability per round of an unexplained style change. */
  noise: number;
  meleeFamily: 'blade' | 'blunt' | 'polearm';
  /** Third stat in the allocation pattern (adds variety to the stat features). */
  extraStat: StatKey;
}

const MELEE_BY_FAMILY: Record<ReactivePersona['meleeFamily'], string[]> = {
  blade: ['knife', 'sword', 'leather_armour', 'longsword', 'sabre', 'rapier'],
  blunt: ['wooden_club', 'leather_armour', 'iron_club', 'mace', 'warhammer'],
  polearm: ['spear', 'leather_armour', 'lance', 'pike'],
};

export function reactivePersona(runSeed: string): ReactivePersona {
  const r = new Rng(hashSeed(`${runSeed}::reactive-persona`));
  return {
    start: r.next() < 0.6 ? 'melee' : 'ranged',
    lossesToSwitch: r.pick([1, 2, 2, 3, 99]),
    counterBoss: r.pick([0, 0.3, 0.6, 0.9]),
    noise: r.pick([0, 0.05, 0.15]),
    meleeFamily: r.pick(['blade', 'blunt', 'polearm'] as const),
    extraStat: r.pick(['str', 'dex', 'def', 'hp'] as StatKey[]),
  };
}

/**
 * Style the reactive agent wants for round `history.length + 1`, replayed from what it has SEEN (results, the
 * boss's gear) plus its persona; per-round randomness is seeded by run + round, so the replay is reproducible.
 */
export function reactiveStyle(p: ReactivePersona, history: RoundOutcome[], runSeed: string): 'melee' | 'ranged' {
  let style = p.start;
  let losses = 0;
  history.forEach((h, k) => {
    const rr = new Rng(hashSeed(`${runSeed}::reactive:${k + 1}`));
    losses = h.winner === 'boss' ? losses + 1 : 0;
    if (losses >= p.lossesToSwitch) {
      style = style === 'melee' ? 'ranged' : 'melee';
      losses = 0;
    }
    const lo = h.bossLoadout;
    if (lo && rr.next() < p.counterBoss) {
      const ids = [lo.hand1, lo.hand2, lo.armour].filter((x): x is string => x !== null).map(requireItem);
      if (ids.some((i) => i.category === 'ranged')) style = 'melee';
      else if (ids.some((i) => i.category === 'shield' || i.id === 'heavy_armour')) style = 'ranged';
    }
    if (rr.next() < p.noise) style = style === 'melee' ? 'ranged' : 'melee';
  });
  return style;
}

export const reactive: Agent = {
  name: 'reactive',
  description: 'Randomised per-run persona (start style, losses before switching, how often it counters the boss\'s visible gear, noise, weapon family); style evolves from what it observed.',
  decide({ state, history, runSeed }) {
    const seed = runSeed ?? 'reactive';
    const p = reactivePersona(seed);
    const wanted = reactiveStyle(p, history, seed);
    return styledDecision(state, wanted, `reactive(${p.start},L${p.lossesToSwitch},c${p.counterBoss},n${p.noise},${p.meleeFamily})`, {
      meleeWishlist: MELEE_BY_FAMILY[p.meleeFamily],
      meleePattern: ['str', 'hp', p.extraStat],
      rangedPattern: ['dex', 'hp', p.extraStat],
    });
  },
  chooser: () => expectedDamageChooser,
};

export const opportunist: Agent = {
  name: 'opportunist',
  description: 'Melee by default; goes ranged after a loss when it can afford/owns a bow, keeps ranged until it wins twice in a row.',
  decide({ state, history }) {
    const lastLost = history.length > 0 && history[history.length - 1].winner === 'boss';
    const wonTwice = history.length >= 2 && history.slice(-2).every((h) => h.winner === 'player');
    const wanted = (lastLost && canFieldRanged(state)) || (usedRanged(state) && !wonTwice) ? 'ranged' : 'melee';
    return styledDecision(state, wanted, 'opportunist');
  },
  chooser: () => expectedDamageChooser,
};

export const switcher: Agent = {
  name: 'switcher',
  description: 'Keeps its current style but switches (melee ↔ ranged) with 35% probability each round (seeded); buys for the chosen style.',
  decide({ state, rng }) {
    const current = usedRanged(state) ? 'ranged' : 'melee';
    const wanted = rng.next() < 0.35 ? (current === 'ranged' ? 'melee' : 'ranged') : current;
    return styledDecision(state, wanted, 'switcher');
  },
  chooser: () => expectedDamageChooser,
};

export const randomAgent: Agent = {
  name: 'random',
  description: 'Random legal choices: allocations, at most one affordable purchase, loadout and attack modes.',
  decide({ state, rng }) {
    const allocations = state.statPoints > 0 ? [{ stat: rng.pick(STAT_KEYS), points: state.statPoints }] : [];
    const affordable = ITEMS.filter((i) => !state.inventory.includes(i.id) && i.cost <= state.gold);
    const purchases = affordable.length && rng.next() < 0.6 ? [rng.pick(affordable).id] : [];
    const inv = after(state, purchases);
    // Sample random candidate loadouts; keep the first legal one (empty hands are always legal).
    let loadout = EMPTY;
    const hands = [null, ...inv.filter((id) => getItem(id)!.category !== 'armour')];
    const armours = [null, ...inv.filter((id) => getItem(id)!.category === 'armour')];
    for (let tries = 0; tries < 12; tries++) {
      const cand: Loadout = { hand1: rng.pick(hands), hand2: rng.pick(hands), armour: rng.pick(armours) };
      if (isLegalLoadout(cand, inv)) {
        loadout = cand;
        break;
      }
    }
    return { allocations, purchases, loadout, note: 'random' };
  },
  chooser: (rng) => (ctx) => ({ mode: rng.pick(ctx.options), source: 'agent', reason: 'Random choice' }),
};

/** Helpers shared with the V4 agent families (sim/agents-v4.ts). */
export type Chooserish = Chooser;
export const agentKit = { buyInOrder, bestOwned, loadoutFrom, allocateByPattern, preferChooser, expectedDamageChooser, after };

/** The pre-V4 agents (sim-3.1.0), kept as a named family for comparisons. */
export const V3_AGENT_NAMES = ['melee_bruiser', 'archer', 'shield_turtle', 'hybrid', 'adaptive', 'piercer', 'duelist', 'opportunist', 'switcher', 'reactive', 'random', 'blocker', 'dodger', 'stunner', 'healer', 'counter_puncher'];

export const AGENTS: Record<string, Agent> = Object.fromEntries(
  [meleeBruiser, archer, shieldTurtle, hybrid, adaptive, piercer, duelist, opportunist, switcher, reactive, randomAgent,
    blocker, dodger, stunner, healer, counterPuncher, ...V4_AGENTS].map((a) => [a.name, a]),
);

export const STRATEGY_NAMES = Object.keys(AGENTS);

export function requireAgent(name: string): Agent {
  const a = AGENTS[name];
  if (!a) throw new Error(`Unknown strategy "${name}". Available: ${STRATEGY_NAMES.join(', ')}`);
  return a;
}
