/**
 * FROZEN V1 catalogue (engine 1.0.0 and 1.1.0). Do not edit.
 * Kept so historical runs, rounds, decisions and training rows stay readable and attributable
 * (e.g. the Axe exists only here). Live rules never use this table — see catalogs/v2.ts.
 */
import type { Item } from '../types.js';

export const ITEMS_V1: readonly Item[] = [
  { id: 'knife', name: 'Knife', category: 'melee', family: 'blade', cost: 5, mods: { str: 3, def: 0, dex: 2 } },
  { id: 'knuckle', name: 'Knuckle', category: 'melee', family: 'blunt', cost: 3, mods: { str: 1, def: 0, dex: 2 } },
  { id: 'sword', name: 'Sword', category: 'melee', family: 'blade', cost: 10, mods: { str: 6, def: 2, dex: 0 } },
  { id: 'rapier', name: 'Rapier', category: 'melee', family: 'blade', cost: 20, mods: { str: 5, def: 2, dex: 2 } },
  { id: 'greatsword', name: 'Greatsword', category: 'melee', family: 'blade', cost: 30, mods: { str: 10, def: 4, dex: -2 } },
  { id: 'wooden_club', name: 'Wooden Club', category: 'melee', family: 'blunt', cost: 7, mods: { str: 4, def: 2, dex: -1 } },
  { id: 'iron_club', name: 'Iron Club', category: 'melee', family: 'blunt', cost: 15, mods: { str: 8, def: 4, dex: -3 } },
  { id: 'axe', name: 'Axe', category: 'melee', family: 'blade', cost: 10, mods: { str: 5, def: 1, dex: 1 } },
  {
    id: 'bow', name: 'Bow', category: 'ranged', family: 'bow', cost: 12, mods: { str: 0, def: 0, dex: 2 },
    pierce: { chance: 0.2, defIgnore: 0.25, placeholder: true },
  },
  {
    id: 'crossbow', name: 'Crossbow', category: 'ranged', family: 'bow', cost: 25, mods: { str: 0, def: 0, dex: 4 },
    pierce: { chance: 0.3, defIgnore: 0.5, placeholder: true },
  },
  { id: 'leather_armour', name: 'Leather Armour', category: 'armour', family: 'armour', cost: 10, mods: { str: 0, def: 2, dex: 0 } },
  { id: 'light_armour', name: 'Light Armour', category: 'armour', family: 'armour', cost: 25, mods: { str: 0, def: 4, dex: -1 } },
  { id: 'heavy_armour', name: 'Heavy Armour', category: 'armour', family: 'armour', cost: 50, mods: { str: 0, def: 8, dex: -4 } },
  { id: 'wood_shield', name: 'Wood Shield', category: 'shield', family: 'shield', cost: 8, mods: { str: 0, def: 3, dex: -1 } },
  { id: 'small_shield', name: 'Small Shield', category: 'shield', family: 'shield', cost: 18, mods: { str: 1, def: 6, dex: -3 } },
  { id: 'great_shield', name: 'Great Shield', category: 'shield', family: 'shield', cost: 36, mods: { str: 2, def: 10, dex: -5 } },
];
