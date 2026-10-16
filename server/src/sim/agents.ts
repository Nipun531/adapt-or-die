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
 *   adaptive       – starts melee, switches style (melee ↔ ranged) after two consecutive losses
 *   random         – random legal allocations, purchases, loadouts and mode choices (exploration/noise)
 */
import { getItem, ITEMS, requireItem } from '../game/catalog.js';
import type { Chooser } from '../game/combat.js';
import { isLegalLoadout } from '../game/equipment.js';
import { bestMode } from '../game/expected.js';
import type { Rng } from '../game/rng.js';
import type { AttackMode, CombatantState, ItemCategory, Loadout, Side, StatKey } from '../game/types.js';
import { STAT_KEYS } from '../game/types.js';

/**
 * Bump when agent behaviour or the meaning of simulated records changes, so data can be traced to the code that produced it.
 *  sim-1.0.0 — engine 1.0.0 (no initial stat points).
 *  sim-1.1.0 — engine 1.1.0: agents spend the 2 initial stat points before round 1 with their normal allocation pattern.
 */
export const SIMULATOR_VERSION = 'sim-1.1.0';

export interface RoundOutcome {
  roundNumber: number;
  winner: Side;
}

export interface AgentContext {
  roundNumber: number;
  state: CombatantState;
  history: RoundOutcome[];
  rng: Rng;
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
function itemScore(id: string, weights: { str: number; def: number; dex: number }): number {
  const m = requireItem(id).mods;
  return m.str * weights.str + m.def * weights.def + m.dex * weights.dex;
}

function bestOwned(inv: string[], cat: ItemCategory, w = { str: 1, def: 1, dex: 1 }): string | null {
  const owned = inv.filter((id) => requireItem(id).category === cat);
  if (!owned.length) return null;
  return owned.reduce((a, b) => (itemScore(b, w) > itemScore(a, w) ? b : a));
}

/**
 * Build a loadout from wanted hand categories (in priority order) + armour, using the best owned item
 * of each category. Falls back to fewer items if a combination would be illegal.
 */
function loadoutFrom(inv: string[], hands: ItemCategory[], wantArmour: boolean, w = { str: 1, def: 1, dex: 1 }): Loadout {
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
  const att = ctx.state.fighters[ctx.side];
  const def = ctx.state.fighters[ctx.side === 'player' ? 'boss' : 'player'];
  const { mode, expected } = bestMode(att, def, ctx.options);
  return { mode, source: 'agent', reason: `Higher expected damage (${Object.entries(expected).map(([m, v]) => `${m} ${v.toFixed(2)}`).join(' vs ')})` };
};

const after = (state: CombatantState, purchases: string[]) => [...state.inventory, ...purchases];

export const meleeBruiser: Agent = {
  name: 'melee_bruiser',
  description: 'Allocates STR/HP; buys Knuckle → Sword → Greatsword plus armour; always melee.',
  decide({ state }) {
    const purchases = buyInOrder(state, ['knuckle', 'sword', 'leather_armour', 'greatsword', 'light_armour', 'heavy_armour']);
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
  description: 'Allocates DEX; buys Bow → Leather Armour → Crossbow; attacks ranged once it owns a bow.',
  decide({ state }) {
    const purchases = buyInOrder(state, ['bow', 'leather_armour', 'crossbow']);
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
    const purchases = buyInOrder(state, ['knuckle', 'bow', 'sword', 'leather_armour', 'crossbow', 'rapier']);
    return {
      allocations: allocateByPattern(state, ['dex', 'str', 'hp']),
      purchases,
      loadout: loadoutFrom(after(state, purchases), ['ranged', 'melee'], true),
      note: 'ranged + melee flexibility',
    };
  },
  chooser: () => expectedDamageChooser,
};

/** Current style of the adaptive agent = derived from history, so it is reproducible without hidden state. */
export function adaptiveStyle(history: RoundOutcome[]): 'melee' | 'ranged' {
  let style: 'melee' | 'ranged' = 'melee';
  let streak = 0;
  for (const h of history) {
    streak = h.winner === 'boss' ? streak + 1 : 0;
    if (streak >= 2) {
      style = style === 'melee' ? 'ranged' : 'melee';
      streak = 0;
    }
  }
  return style;
}

export const adaptive: Agent = {
  name: 'adaptive',
  description: 'Starts melee; after two consecutive losses switches style (melee ↔ ranged) and re-gears.',
  decide({ state, history }) {
    const style = adaptiveStyle(history);
    const wishlist = style === 'ranged'
      ? ['bow', 'leather_armour', 'crossbow', 'sword']
      : ['knuckle', 'sword', 'leather_armour', 'axe', 'greatsword'];
    const purchases = buyInOrder(state, wishlist);
    const inv = after(state, purchases);
    const loadout = style === 'ranged' && bestOwned(inv, 'ranged')
      ? loadoutFrom(inv, ['ranged'], true, { str: 0, def: 0.2, dex: 1 })
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

export const AGENTS: Record<string, Agent> = Object.fromEntries(
  [meleeBruiser, archer, shieldTurtle, hybrid, adaptive, randomAgent].map((a) => [a.name, a]),
);

export const STRATEGY_NAMES = Object.keys(AGENTS);

export function requireAgent(name: string): Agent {
  const a = AGENTS[name];
  if (!a) throw new Error(`Unknown strategy "${name}". Available: ${STRATEGY_NAMES.join(', ')}`);
  return a;
}
