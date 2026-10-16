/**
 * Equipment catalogue — copied verbatim from the game plan tables (§7 Weapons, §8 Armour and Shields).
 * "—" in the plan is stored as 0. Bow/Crossbow STR modifiers were removed by the plan.
 * Pierce numbers are DEVELOPER-APPROVED PLACEHOLDERS (plan says each bow/crossbow has one, but gives no values).
 */
import type { Item } from './types.js';

export const ITEMS: Item[] = [
  // --- Melee weapons (any of these fills the plan's "Sword" slot category) ---
  { id: 'knife', name: 'Knife', category: 'melee', cost: 5, mods: { str: 3, def: 0, dex: 2 } },
  { id: 'knuckle', name: 'Knuckle', category: 'melee', cost: 3, mods: { str: 1, def: 0, dex: 2 } },
  { id: 'sword', name: 'Sword', category: 'melee', cost: 10, mods: { str: 6, def: 2, dex: 0 } },
  { id: 'rapier', name: 'Rapier', category: 'melee', cost: 20, mods: { str: 5, def: 2, dex: 2 } },
  { id: 'greatsword', name: 'Greatsword', category: 'melee', cost: 30, mods: { str: 10, def: 4, dex: -2 } },
  { id: 'wooden_club', name: 'Wooden Club', category: 'melee', cost: 7, mods: { str: 4, def: 2, dex: -1 } },
  { id: 'iron_club', name: 'Iron Club', category: 'melee', cost: 15, mods: { str: 8, def: 4, dex: -3 } },
  { id: 'axe', name: 'Axe', category: 'melee', cost: 10, mods: { str: 5, def: 1, dex: 1 } },

  // --- Ranged weapons (attack value uses DEX) ---
  {
    id: 'bow', name: 'Bow', category: 'ranged', cost: 12, mods: { str: 0, def: 0, dex: 2 },
    pierce: { chance: 0.2, defIgnore: 0.25, placeholder: true },
  },
  {
    id: 'crossbow', name: 'Crossbow', category: 'ranged', cost: 25, mods: { str: 0, def: 0, dex: 4 },
    pierce: { chance: 0.3, defIgnore: 0.5, placeholder: true },
  },

  // --- Armour (separate body slot) ---
  { id: 'leather_armour', name: 'Leather Armour', category: 'armour', cost: 10, mods: { str: 0, def: 2, dex: 0 } },
  { id: 'light_armour', name: 'Light Armour', category: 'armour', cost: 25, mods: { str: 0, def: 4, dex: -1 } },
  { id: 'heavy_armour', name: 'Heavy Armour', category: 'armour', cost: 50, mods: { str: 0, def: 8, dex: -4 } },

  // --- Shields (hand slot) ---
  { id: 'wood_shield', name: 'Wood Shield', category: 'shield', cost: 8, mods: { str: 0, def: 3, dex: -1 } },
  { id: 'small_shield', name: 'Small Shield', category: 'shield', cost: 18, mods: { str: 1, def: 6, dex: -3 } },
  { id: 'great_shield', name: 'Great Shield', category: 'shield', cost: 36, mods: { str: 2, def: 10, dex: -5 } },
];

const BY_ID = new Map(ITEMS.map((i) => [i.id, i]));

export function getItem(id: string): Item | undefined {
  return BY_ID.get(id);
}

/** Like getItem but throws — use where the id has already been validated. */
export function requireItem(id: string): Item {
  const item = BY_ID.get(id);
  if (!item) throw new Error(`Unknown item id "${id}"`);
  return item;
}
