/**
 * Equipment / economy / stat-allocation rules and validation.
 * Every function returns a NEW state (no mutation) or throws a RuleError with a user-readable message.
 * The player API, the boss decision layer and simulation agents all go through these functions.
 */
import { getItem } from './catalog.js';
import { STAT_ALLOCATION_INCREASE, STIM_BASE_SLOTS, STIM_COST, STIM_MAX_EFFECTIVENESS, STIM_MAX_SLOTS, STIM_UPGRADE_BASE_COST, STIM_UPGRADE_STEP } from './constants.js';
import type { CombatantState, ItemCategory, Loadout, StatKey, Supplies } from './types.js';
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

// ---------------------------------------------------------------------------------------------------------------
// V3 healing-stim economy (docs/V3_DEMANDS.md §6). Same rules for player, boss and simulation agents.
// ---------------------------------------------------------------------------------------------------------------

export type SupplyAction = 'buy_stim' | 'upgrade_slots' | 'upgrade_effectiveness';

/** Supplies of a state (pre-V3 states have none: 0 stims, 1 slot). */
export function suppliesOf(state: CombatantState): Supplies {
  return state.supplies ?? { stims: 0, slots: STIM_BASE_SLOTS, effectiveness: 0 };
}

/** Price of the next upgrade of a kind: 25, 30, 35, … (+5 per upgrade of that kind already bought). */
export function supplyCost(state: CombatantState, action: SupplyAction): number {
  const s = suppliesOf(state);
  if (action === 'buy_stim') return STIM_COST;
  const bought = action === 'upgrade_slots' ? s.slots - STIM_BASE_SLOTS : s.effectiveness;
  return STIM_UPGRADE_BASE_COST + STIM_UPGRADE_STEP * bought;
}

/** Returns null when legal, otherwise the reason. */
export function supplyProblem(state: CombatantState, action: SupplyAction): string | null {
  const s = suppliesOf(state);
  const cost = supplyCost(state, action);
  if (action === 'buy_stim' && s.stims >= s.slots) return `No empty stim slot (${s.stims}/${s.slots}); upgrade slots to carry more`;
  if (action === 'upgrade_slots' && s.slots >= STIM_MAX_SLOTS) return `Stim slots are at the maximum (${STIM_MAX_SLOTS})`;
  if (action === 'upgrade_effectiveness' && s.effectiveness >= STIM_MAX_EFFECTIVENESS) return `Stim effectiveness is at the maximum (${STIM_MAX_EFFECTIVENESS} upgrades)`;
  if (state.gold < cost) return `Not enough gold (cost ${cost}, have ${state.gold})`;
  return null;
}

/** Buy a stim / an upgrade. Gold never goes negative. */
export function buySupply(state: CombatantState, action: SupplyAction): CombatantState {
  const problem = supplyProblem(state, action);
  if (problem) throw new RuleError(problem);
  const s = { ...suppliesOf(state) };
  const cost = supplyCost(state, action);
  if (action === 'buy_stim') s.stims++;
  else if (action === 'upgrade_slots') s.slots++;
  else s.effectiveness++;
  return { ...state, gold: state.gold - cost, supplies: s };
}
