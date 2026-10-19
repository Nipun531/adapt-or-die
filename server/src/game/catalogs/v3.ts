/**
 * V3 catalogue (engine 3.0.0) — docs/V3_DEMANDS.md §7. NOT LIVE YET: the live tables stay V2 until Phase C2;
 * RuleSet v3 (game/rules.ts) reads this table.
 *
 * - Costs and STR/DEF/DEX modifiers: the V3 design doc (identical to V2 except Warhammer 40 → 45, owner Q-4).
 * - Pierce: the tuned V2 values (owner decision).
 * - Combat properties (block bonus, stun boost, can-stun, dodge counter): the V3 design doc. Provisional — tune only
 *   with owner approval.
 */
import type { Item, ItemCombat } from '../types.js';
import { ITEMS_V2 } from './v2.js';

const COMBAT: Record<string, ItemCombat> = {
  wooden_club: { stunBoost: 0.04 },
  iron_club: { stunBoost: 0.08, canStun: true },
  mace: { stunBoost: 0.12, canStun: true },
  flail: { canStun: true, dodgeCounter: 0.05 },
  warhammer: { stunBoost: 0.2, canStun: true },
  spear: { dodgeCounter: 0.1 },
  lance: { dodgeCounter: 0.2 },
  pike: { dodgeCounter: 0.3 },
  light_armour: { blockBonus: 0.02 },
  heavy_armour: { blockBonus: 0.05 },
  wood_shield: { blockBonus: 0.1 },
  small_shield: { blockBonus: 0.2 },
  great_shield: { blockBonus: 0.3 },
};

const COST: Record<string, number> = { warhammer: 45 };

export const ITEMS_V3: readonly Item[] = ITEMS_V2.map((i) => ({
  ...i,
  mods: { ...i.mods },
  ...(i.pierce ? { pierce: { ...i.pierce } } : {}),
  ...(COST[i.id] !== undefined ? { cost: COST[i.id] } : {}),
  ...(COMBAT[i.id] ? { combat: { ...COMBAT[i.id] } } : {}),
}));
