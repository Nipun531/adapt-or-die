/**
 * Where a picked item goes in the hand (UX only — the server re-validates every loadout).
 * Armour → body slot. A hand item goes to the slot the player chose; otherwise it replaces the hand that holds the
 * same category (a new blade replaces the old blade), else the first empty hand, else the second hand.
 */
import type { Item, Loadout } from '../api';

export type SlotKey = 'hand1' | 'hand2' | 'armour';

export function proposeLoadout(current: Loadout, item: Item, find: (id: string) => Item | undefined, slot?: SlotKey): { loadout: Loadout; slot: SlotKey } {
  if (item.category === 'armour') return { loadout: { ...current, armour: item.id }, slot: 'armour' };
  const lo = { ...current };
  const other = (s: 'hand1' | 'hand2') => (s === 'hand1' ? 'hand2' : 'hand1');
  let target: 'hand1' | 'hand2';
  if (slot === 'hand1' || slot === 'hand2') target = slot;
  else if (lo.hand1 === item.id || lo.hand2 === item.id) target = lo.hand1 === item.id ? 'hand1' : 'hand2';
  else {
    const same = (['hand1', 'hand2'] as const).find((s) => lo[s] && find(lo[s]!)?.category === item.category);
    target = same ?? (!lo.hand1 ? 'hand1' : !lo.hand2 ? 'hand2' : 'hand2');
  }
  if (lo[other(target)] === item.id) lo[other(target)] = null; // the same item cannot fill both hands
  lo[target] = item.id;
  return { loadout: lo, slot: target };
}

export function removeFromSlot(current: Loadout, slot: SlotKey): Loadout {
  return { ...current, [slot]: null };
}
