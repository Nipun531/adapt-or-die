/**
 * Equipment catalogue access.
 *
 * LIVE rules (shop, equip, combat, boss, simulations) use the V2 table only: `ITEMS`, `getItem`, `requireItem`.
 * HISTORY (old runs, rounds, decisions, training rows) resolves ids against the catalogue of the engine version
 * that produced the record: `catalogFor(engineVersion)` / `itemForHistory(id, engineVersion)`.
 * Ids are stable across versions where the item concept is the same; `axe` exists only in V1.
 */
import { ITEMS_V1 } from './catalogs/v1.js';
import { ITEMS_V2 } from './catalogs/v2.js';
import { ITEMS_V3 } from './catalogs/v3.js';
import type { Item, ItemCategory } from './types.js';

export { ITEMS_V1, ITEMS_V2, ITEMS_V3 };

/** The live catalogue (engine 2.0.0). */
export const ITEMS: readonly Item[] = ITEMS_V2;

const BY_ID = new Map(ITEMS.map((i) => [i.id, i]));
const BY_ID_V1 = new Map(ITEMS_V1.map((i) => [i.id, i]));
const BY_ID_V3 = new Map(ITEMS_V3.map((i) => [i.id, i]));

/** V3 table lookup (RuleSet v3; not live until Phase C2). Throws on unknown ids. */
export function requireItemV3(id: string): Item {
  const item = BY_ID_V3.get(id);
  if (!item) throw new Error(`Unknown V3 item id "${id}"`);
  return item;
}

export function getItem(id: string): Item | undefined {
  return BY_ID.get(id);
}

/** Like getItem but throws — use where the id has already been validated. */
export function requireItem(id: string): Item {
  const item = BY_ID.get(id);
  if (!item) throw new Error(`Unknown item id "${id}"`);
  return item;
}

/** Catalogue that applied under a given engine version (1.x → V1, 3.x → V3, otherwise V2). */
export function catalogFor(engineVersion: string | null | undefined): readonly Item[] {
  if (engineVersion?.startsWith('1.')) return ITEMS_V1;
  if (engineVersion?.startsWith('3.')) return ITEMS_V3;
  return ITEMS_V2;
}

/**
 * Resolve an id for a historical record: the catalogue of its engine first, then the other one
 * (so a name can always be shown). Throws only for ids that never existed.
 */
export function itemForHistory(id: string, engineVersion?: string | null): Item {
  const primary = engineVersion && engineVersion.startsWith('1.') ? BY_ID_V1 : BY_ID;
  const item = primary.get(id) ?? BY_ID.get(id) ?? BY_ID_V1.get(id);
  if (!item) throw new Error(`Unknown item id "${id}" (engine ${engineVersion ?? 'current'})`);
  return item;
}

/** Cheapest live item of a category (e.g. the price of the cheapest ranged weapon). */
export function cheapestCost(category: ItemCategory, items: readonly Item[] = ITEMS): number {
  return Math.min(...items.filter((i) => i.category === category).map((i) => i.cost));
}
