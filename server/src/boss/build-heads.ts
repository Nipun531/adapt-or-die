/**
 * NEXT-BUILD "HEADS" (V4, docs/V4_IMPLEMENTATION_PLAN.md §4): the player's preparation for a round, decomposed along
 * the decisions the game actually offers. Pure and rule-based — the same code labels training data, records Learning
 * Boss observations, feeds the oracle and matches legal candidate builds, so all of them agree.
 *
 *   hands   which legal hand combination they fielded (shield + weapon, bow + melee, one item, empty)
 *   family  melee family of their melee weapon (none when they fielded no melee weapon)
 *   armour  none / keep (same armour as last round) / upgrade (new or better armour)
 *   alloc   the stat that received most of this round's stat points (none when no points were spent)
 *
 * `headsOf(prev, snap)`: prev = the player's state BEFORE preparing (last round's post-state, or the initial state),
 * snap = the fighter snapshot they actually brought into the round. Only the player's own choices are encoded — not
 * whether they worked.
 */
import { itemForHistory } from '../game/catalog.js';
import { STAT_ALLOCATION_INCREASE } from '../game/constants.js';
import type { CombatantState, FighterSnapshot, Item, Loadout, StatKey } from '../game/types.js';
import { STAT_KEYS } from '../game/types.js';

export const HEAD_CLASSES = {
  hands: ['ranged', 'ranged_melee', 'ranged_shield', 'melee', 'melee_shield', 'shield', 'empty'],
  family: ['blade', 'blunt', 'polearm', 'none'],
  armour: ['none', 'keep', 'upgrade'],
  alloc: ['str', 'def', 'dex', 'hp', 'none'],
} as const;
export type HeadName = keyof typeof HEAD_CLASSES;
export const HEAD_NAMES = Object.keys(HEAD_CLASSES) as HeadName[];
export type Heads = { [K in HeadName]: (typeof HEAD_CLASSES)[K][number] };
/** Version of the head definitions above (bump on any change; stored with every build example). */
export const BUILD_TARGET_VERSION = 'b1';

const item = (id: string | null, ev?: string | null): Item | null => (id ? itemForHistory(id, ev) : null);

export function handsOf(loadout: Loadout, ev?: string | null): Heads['hands'] {
  const cats = [loadout.hand1, loadout.hand2].map((id) => item(id, ev)?.category).filter(Boolean);
  const r = cats.includes('ranged');
  const m = cats.includes('melee');
  const s = cats.includes('shield');
  if (r && m) return 'ranged_melee';
  if (r && s) return 'ranged_shield';
  if (r) return 'ranged';
  if (m && s) return 'melee_shield';
  if (m) return 'melee';
  if (s) return 'shield';
  return 'empty';
}

export function familyOf(loadout: Loadout, ev?: string | null): Heads['family'] {
  const melee = [loadout.hand1, loadout.hand2].map((id) => item(id, ev)).find((i) => i?.category === 'melee');
  return melee && (['blade', 'blunt', 'polearm'] as const).includes(melee.family as 'blade') ? (melee.family as Heads['family']) : 'none';
}

export function armourOf(prev: Loadout, now: Loadout, ev?: string | null): Heads['armour'] {
  if (!now.armour) return 'none';
  if (now.armour === prev.armour) return 'keep';
  const before = item(prev.armour, ev);
  const after = item(now.armour, ev)!;
  return !before || after.cost >= before.cost ? 'upgrade' : 'keep';
}

/** Stat points spent per stat in the preparation (stat gains ÷ the per-point increase; level-ups happen post-round). */
export function pointsSpent(prev: CombatantState, snapStats: CombatantState['stats']): Record<StatKey, number> {
  return Object.fromEntries(STAT_KEYS.map((k) => [k, Math.max(0, Math.round((snapStats[k] - prev.stats[k]) / STAT_ALLOCATION_INCREASE[k]))])) as Record<StatKey, number>;
}

export function allocOf(prev: CombatantState, snapStats: CombatantState['stats']): Heads['alloc'] {
  const pts = pointsSpent(prev, snapStats);
  let best: Heads['alloc'] = 'none';
  let n = 0;
  for (const k of ['str', 'def', 'dex', 'hp'] as const) if (pts[k] > n) { best = k; n = pts[k]; } // ties → the earlier stat
  return best;
}

export function headsOf(prev: CombatantState, snap: Pick<FighterSnapshot, 'loadout' | 'stats'>, ev?: string | null): Heads {
  return {
    hands: handsOf(snap.loadout, ev),
    family: familyOf(snap.loadout, ev),
    armour: armourOf(prev.loadout, snap.loadout, ev),
    alloc: allocOf(prev, snap.stats),
  };
}
