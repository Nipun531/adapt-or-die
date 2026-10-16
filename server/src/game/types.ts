/**
 * Shared domain types for the game engine.
 * Pure data shapes only — no logic. Used by rules, combat, boss AI, simulation and persistence.
 */

export type Side = 'player' | 'boss';
export const otherSide = (s: Side): Side => (s === 'player' ? 'boss' : 'player');

/** The four core attributes from the game plan (HP, STR/ATK, DEF, DEX/AGI). */
export type StatKey = 'hp' | 'str' | 'def' | 'dex';
export const STAT_KEYS: StatKey[] = ['hp', 'str', 'def', 'dex'];
export type Stats = Record<StatKey, number>;

/** Equipment categories. "melee" covers every non-ranged weapon (the plan's "Sword" slot category). */
export type ItemCategory = 'melee' | 'ranged' | 'shield' | 'armour';

/** Modifier columns exactly as listed in the plan's weapon/armour tables. Missing ("—") = 0. */
export interface ItemMods {
  str: number;
  def: number;
  dex: number;
}

export interface PierceSpec {
  /** Probability (0..1) that a ranged attack pierces. */
  chance: number;
  /** Fraction (0..1) of the defender's Net DEF ignored when piercing succeeds. */
  defIgnore: number;
  /** True while the numbers are developer-approved placeholders (the plan does not specify them). */
  placeholder: boolean;
}

export interface Item {
  id: string;
  name: string;
  category: ItemCategory;
  cost: number;
  mods: ItemMods;
  pierce?: PierceSpec;
}

/** Two hand slots plus a separate armour (body) slot. null = empty slot. */
export interface Loadout {
  hand1: string | null;
  hand2: string | null;
  armour: string | null;
}

/** How an attack is made. "unarmed" = STR melee with no weapon equipped. */
export type AttackMode = 'melee' | 'ranged' | 'unarmed';

/** Full mutable progression state of one combatant (player or boss share this shape). */
export interface CombatantState {
  side: Side;
  level: number;
  /** XP accumulated toward the next level (surplus carries over after a level-up). */
  xp: number;
  gold: number;
  statPoints: number;
  stats: Stats;
  inventory: string[];
  loadout: Loadout;
}

/** Combat-ready numbers derived from a combatant's stats + equipped gear (see rules/derive.ts). */
export interface DerivedStats {
  maxHp: number;
  strModSum: number;
  defModSum: number;
  dexModSum: number;
  /** Net ATK used for melee/unarmed attacks. */
  netAtk: number;
  /** Net DEF used by the defender in every damage calculation. */
  netDef: number;
  /** Net DEX before flooring (shown for transparency; can be <= 0 with heavy DEX penalties). */
  netDexRaw: number;
  /** Net DEX floored at EFFECTIVE_DEX_FLOOR. Used for ranged attack value, mitigation, bonus attacks, priority. */
  effDex: number;
  attackModes: AttackMode[];
  rangedWeaponId: string | null;
  meleeWeaponId: string | null;
}

/** Immutable snapshot of a fighter taken when a round starts. */
export interface FighterSnapshot {
  side: Side;
  level: number;
  stats: Stats;
  loadout: Loadout;
  derived: DerivedStats;
}
