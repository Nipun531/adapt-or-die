/**
 * Equipment / economy / stat-allocation rules and validation.
 * Every function returns a NEW state (no mutation) or throws a RuleError with a user-readable message.
 * The player API, the boss decision layer and simulation agents all go through these functions.
 */
import { getItem } from './catalog.js';
import { STAT_ALLOCATION_INCREASE } from './constants.js';
import type { CombatantState, ItemCategory, Loadout, StatKey } from './types.js';
import { STAT_KEYS } from './types.js';

export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleError';
  }
}

/**
 * Legal hand-slot combinations (order-insensitive). Plan §6 lists Shield+Sword, Shield+Bow, Bow+Sword.
 * DECISION: any melee weapon counts as "Sword"; one item or empty hands are also legal; armour has its own slot.
 */
const LEGAL_HAND_SETS: ItemCategory[][] = [
  [],
  ['shield'],
  ['melee'],
  ['ranged'],
  ['melee', 'shield'],
  ['ranged', 'shield'],
  ['melee', 'ranged'],
];

function handKey(cats: ItemCategory[]): string {
  return [...cats].sort().join('+');
}
const LEGAL_HAND_KEYS = new Set(LEGAL_HAND_SETS.map(handKey));

/** Returns null when legal, otherwise a reason string. Checks ownership, slot types and the 2-hand-slot rule. */
export function loadoutProblem(loadout: Loadout, inventory: string[]): string | null {
  const hands = [loadout.hand1, loadout.hand2].filter((x): x is string => x !== null);
  const all = [...hands, ...(loadout.armour ? [loadout.armour] : [])];
  for (const id of all) {
    if (!getItem(id)) return `Unknown item "${id}"`;
    if (!inventory.includes(id)) return `Item "${id}" is not owned`;
  }
  if (hands.length === 2 && hands[0] === hands[1]) return 'The same item cannot fill both hand slots';
  if (loadout.armour && getItem(loadout.armour)!.category !== 'armour') {
    return 'Only armour can be equipped in the armour slot';
  }
  const cats = hands.map((id) => getItem(id)!.category);
  if (cats.includes('armour')) return 'Armour cannot be equipped in a hand slot';
  if (!LEGAL_HAND_KEYS.has(handKey(cats))) {
    return `Illegal hand combination (${cats.join(' + ')}). Allowed: Shield+Melee, Shield+Ranged, Ranged+Melee, a single item, or empty`;
  }
  return null;
}

export function isLegalLoadout(loadout: Loadout, inventory: string[]): boolean {
  return loadoutProblem(loadout, inventory) === null;
}

export function equip(state: CombatantState, loadout: Loadout): CombatantState {
  const problem = loadoutProblem(loadout, state.inventory);
  if (problem) throw new RuleError(problem);
  return { ...state, loadout: { ...loadout } };
}

/** Returns null when the purchase is legal, otherwise the reason. */
export function purchaseProblem(state: CombatantState, itemId: string): string | null {
  const item = getItem(itemId);
  if (!item) return `Unknown item "${itemId}"`;
  if (state.inventory.includes(itemId)) return `${item.name} is already owned`;
  if (state.gold < item.cost) return `Not enough gold for ${item.name} (cost ${item.cost}, have ${state.gold})`;
  return null;
}

/** Buy an item into the inventory (does not equip it). Gold can never go negative. */
export function purchase(state: CombatantState, itemId: string): CombatantState {
  const problem = purchaseProblem(state, itemId);
  if (problem) throw new RuleError(problem);
  const item = getItem(itemId)!;
  return { ...state, gold: state.gold - item.cost, inventory: [...state.inventory, itemId] };
}

/** Spend stat points: each point adds the plan's stat-allocation increase (HP+5, STR+3, DEF+2, DEX+2). */
export function allocateStat(state: CombatantState, stat: StatKey, points: number): CombatantState {
  if (!STAT_KEYS.includes(stat)) throw new RuleError(`Unknown stat "${stat}"`);
  if (!Number.isInteger(points) || points <= 0) throw new RuleError('Points must be a positive integer');
  if (points > state.statPoints) {
    throw new RuleError(`Not enough stat points (requested ${points}, have ${state.statPoints})`);
  }
  return {
    ...state,
    statPoints: state.statPoints - points,
    stats: { ...state.stats, [stat]: state.stats[stat] + STAT_ALLOCATION_INCREASE[stat] * points },
  };
}
