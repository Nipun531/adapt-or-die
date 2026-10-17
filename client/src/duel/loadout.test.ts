/** Armory slot logic (UX only — the server re-validates every loadout). */
import { describe, expect, it } from 'vitest';
import type { Item, Loadout } from '../api';
import { proposeLoadout, removeFromSlot } from './loadout';

const item = (id: string, category: Item['category']): Item => ({ id, name: id, category, family: category === 'ranged' ? 'bow' : category === 'shield' ? 'shield' : category === 'armour' ? 'armour' : 'blade', cost: 1, mods: { str: 0, def: 0, dex: 0 } });
const ITEMS = [item('sword', 'melee'), item('mace', 'melee'), item('bow', 'ranged'), item('wood_shield', 'shield'), item('leather_armour', 'armour')];
const find = (id: string) => ITEMS.find((i) => i.id === id);
const L = (hand1: string | null, hand2: string | null, armour: string | null = null): Loadout => ({ hand1, hand2, armour });

describe('proposeLoadout', () => {
  it('armour always goes to the body slot', () => {
    expect(proposeLoadout(L('sword', null), find('leather_armour')!, find)).toEqual({ loadout: L('sword', null, 'leather_armour'), slot: 'armour' });
  });
  it('a new weapon replaces the hand that holds the same category', () => {
    expect(proposeLoadout(L('wood_shield', 'sword'), find('mace')!, find)).toEqual({ loadout: L('wood_shield', 'mace'), slot: 'hand2' });
  });
  it('otherwise fills the first empty hand', () => {
    expect(proposeLoadout(L('sword', null), find('bow')!, find).loadout).toEqual(L('sword', 'bow'));
    expect(proposeLoadout(L(null, null), find('bow')!, find).loadout).toEqual(L('bow', null));
  });
  it('an explicit slot wins, and the same item never fills both hands', () => {
    expect(proposeLoadout(L('sword', 'bow'), find('bow')!, find, 'hand1').loadout).toEqual(L('bow', null));
  });
  it('removeFromSlot empties one slot', () => {
    expect(removeFromSlot(L('sword', 'bow', 'leather_armour'), 'hand2')).toEqual(L('sword', null, 'leather_armour'));
  });
});
