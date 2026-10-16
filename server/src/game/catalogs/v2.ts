/**
 * LIVE V2 catalogue (engine 2.0.0) — docs/V2_DEMANDS.md §2.1.
 * Costs and STR/DEF/DEX modifiers are the user's values (do not change without approval).
 * Pierce chance / DEF-ignore values were delegated to Claude for buffing (V2_DEMANDS §11.1, Q-5). They were tuned
 * with the balance harness (npm run balance -- tune; buff only) — the user's original values are noted per line;
 * evidence in docs/V2_BALANCE.md.
 * Pierce applies to every attack made WITH the weapon (melee or ranged).
 */
import type { Item } from '../types.js';

const p = (chance: number, defIgnore: number) => ({ chance, defIgnore, placeholder: false });

export const ITEMS_V2: readonly Item[] = [
  // --- Melee: fists & blades ---
  { id: 'knuckle', name: 'Knuckle', category: 'melee', family: 'blunt', cost: 3, mods: { str: 1, def: 0, dex: 2 } },
  { id: 'knife', name: 'Knife', category: 'melee', family: 'blade', cost: 5, mods: { str: 2, def: 0, dex: 2 } },
  { id: 'sword', name: 'Sword', category: 'melee', family: 'blade', cost: 10, mods: { str: 4, def: 1, dex: 0 } },
  { id: 'longsword', name: 'LongSword', category: 'melee', family: 'blade', cost: 20, mods: { str: 7, def: 2, dex: 0 } },
  { id: 'sabre', name: 'Sabre', category: 'melee', family: 'blade', cost: 20, mods: { str: 5, def: 1, dex: 2 } },
  { id: 'greatsword', name: 'GreatSword', category: 'melee', family: 'blade', cost: 40, mods: { str: 10, def: 3, dex: -2 } },
  { id: 'rapier', name: 'Rapier', category: 'melee', family: 'blade', cost: 40, mods: { str: 6, def: 1, dex: 3 }, pierce: p(0.05, 0.7) }, // unchanged: already strongest late weapon (DEX +3)
  // --- Melee: blunt ---
  { id: 'wooden_club', name: 'Wooden Club', category: 'melee', family: 'blunt', cost: 7, mods: { str: 3, def: 1, dex: 0 } },
  { id: 'iron_club', name: 'Iron Club', category: 'melee', family: 'blunt', cost: 15, mods: { str: 5, def: 2, dex: -1 } },
  { id: 'mace', name: 'Mace', category: 'melee', family: 'blunt', cost: 25, mods: { str: 8, def: 2, dex: -1 } },
  { id: 'flail', name: 'Flail', category: 'melee', family: 'blunt', cost: 30, mods: { str: 4, def: 1, dex: 0 }, pierce: p(0.45, 0.9) }, // was 20%/50%
  { id: 'warhammer', name: 'Warhammer', category: 'melee', family: 'blunt', cost: 40, mods: { str: 12, def: 2, dex: -3 } },
  // --- Ranged (First Shot) ---
  { id: 'bow', name: 'Bow', category: 'ranged', family: 'bow', cost: 15, mods: { str: 0, def: 0, dex: 2 }, pierce: p(0.55, 0.9) }, // was 30%/30%
  { id: 'crossbow', name: 'Crossbow', category: 'ranged', family: 'bow', cost: 28, mods: { str: 0, def: 0, dex: 4 }, pierce: p(0.25, 0.45) }, // unchanged: already top mid-game weapon
  { id: 'longbow', name: 'Longbow', category: 'ranged', family: 'bow', cost: 42, mods: { str: 0, def: 0, dex: 3 }, pierce: p(0.45, 0.6) }, // was 40%/55%
  // --- Melee: polearms ---
  { id: 'spear', name: 'Spear', category: 'melee', family: 'polearm', cost: 15, mods: { str: 3, def: 0, dex: 1 }, pierce: p(0.35, 0.35) }, // was 10%/25%
  { id: 'lance', name: 'Lance', category: 'melee', family: 'polearm', cost: 28, mods: { str: 5, def: 0, dex: 0 }, pierce: p(0.6, 0.75) }, // was 20%/35%
  { id: 'pike', name: 'Pike', category: 'melee', family: 'polearm', cost: 42, mods: { str: 7, def: 0, dex: -1 }, pierce: p(0.6, 0.9) }, // was 35%/60%
  // --- Armor (body slot) ---
  { id: 'leather_armour', name: 'Leather Armor', category: 'armour', family: 'armour', cost: 10, mods: { str: 0, def: 2, dex: 0 } },
  { id: 'light_armour', name: 'Light Armor', category: 'armour', family: 'armour', cost: 25, mods: { str: 0, def: 4, dex: -1 } },
  { id: 'heavy_armour', name: 'Heavy Armor', category: 'armour', family: 'armour', cost: 45, mods: { str: 0, def: 8, dex: -4 } },
  // --- Shields (hand slot) ---
  { id: 'wood_shield', name: 'Wood Shield', category: 'shield', family: 'shield', cost: 8, mods: { str: 0, def: 3, dex: -1 } },
  { id: 'small_shield', name: 'Small Shield', category: 'shield', family: 'shield', cost: 20, mods: { str: 0, def: 5, dex: -2 } },
  { id: 'great_shield', name: 'Great Shield', category: 'shield', family: 'shield', cost: 42, mods: { str: 1, def: 8, dex: -5 } },
];
