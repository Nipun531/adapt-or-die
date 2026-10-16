/**
 * Derives combat numbers (Net ATK, Net DEF, Net/effective DEX, available attack modes) from a
 * combatant's stats and equipped gear. Single source of truth for both player and boss.
 *
 * DECISION (approved): modifier sums include ALL equipped gear (both hands + armour):
 *   STR mods → Net ATK, DEF mods → Net DEF, DEX mods → Net DEX.
 */
import { requireItem } from './catalog.js';
import { effectiveDex, netAtk, netDef, netDex } from './formulas.js';
import type { AttackMode, CombatantState, DerivedStats, FighterSnapshot, Item, Loadout, Stats } from './types.js';

/** Item resolver: live catalogue by default; history views pass an engine-aware one (catalog.itemForHistory). */
export type ItemLookup = (id: string) => Item;

export function equippedIds(loadout: Loadout): string[] {
  return [loadout.hand1, loadout.hand2, loadout.armour].filter((x): x is string => x !== null);
}

/**
 * Attack modes available with a loadout:
 *  - ranged + melee in hands → choice of 'ranged' (DEX) or 'melee' (STR) per attack (developer decision)
 *  - only ranged             → 'ranged'
 *  - only melee              → 'melee'
 *  - no weapon               → 'unarmed' (STR melee, no weapon)
 */
export function attackModesFor(loadout: Loadout, lookup: ItemLookup = requireItem): AttackMode[] {
  const cats = [loadout.hand1, loadout.hand2].filter((x): x is string => x !== null).map((id) => lookup(id).category);
  const hasRanged = cats.includes('ranged');
  const hasMelee = cats.includes('melee');
  if (hasRanged && hasMelee) return ['ranged', 'melee'];
  if (hasRanged) return ['ranged'];
  if (hasMelee) return ['melee'];
  return ['unarmed'];
}

export function deriveStats(stats: Stats, loadout: Loadout, lookup: ItemLookup = requireItem): DerivedStats {
  const items = equippedIds(loadout).map((id) => lookup(id));
  const strModSum = items.reduce((s, i) => s + i.mods.str, 0);
  const defModSum = items.reduce((s, i) => s + i.mods.def, 0);
  const dexModSum = items.reduce((s, i) => s + i.mods.dex, 0);
  const netDexRaw = netDex(stats.dex, dexModSum);
  const ranged = items.find((i) => i.category === 'ranged');
  const melee = items.find((i) => i.category === 'melee');
  return {
    maxHp: stats.hp,
    strModSum,
    defModSum,
    dexModSum,
    netAtk: netAtk(stats.str, strModSum),
    netDef: netDef(stats.def, defModSum),
    netDexRaw,
    effDex: effectiveDex(netDexRaw),
    attackModes: attackModesFor(loadout, lookup),
    rangedWeaponId: ranged?.id ?? null,
    meleeWeaponId: melee?.id ?? null,
  };
}

export function snapshotOf(state: CombatantState): FighterSnapshot {
  return {
    side: state.side,
    level: state.level,
    stats: { ...state.stats },
    loadout: { ...state.loadout },
    derived: deriveStats(state.stats, state.loadout),
  };
}
