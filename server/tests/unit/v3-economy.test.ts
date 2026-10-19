/** V3 economy (docs/V3_DEMANDS.md §6): 10 starting gold, healing stims, slot and effectiveness upgrades. */
import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION, STARTING_GOLD } from '../../src/game/constants.js';
import { catalogFor, ITEMS, ITEMS_V2, ITEMS_V3, itemForHistory, requireItem } from '../../src/game/catalog.js';
import { snapshotOf } from '../../src/game/derive.js';
import { buySupply, RuleError, supplyCost, supplyProblem, suppliesOf } from '../../src/game/equipment.js';
import { initialCombatant } from '../../src/game/progression.js';

const rich = (gold: number) => ({ ...initialCombatant('player'), gold });

describe('engine 3.0.0 economy', () => {
  it('starts with 10 gold, 1 empty stim slot; the live catalogue is V3', () => {
    expect(ENGINE_VERSION).toBe('3.1.0');
    expect(STARTING_GOLD).toBe(10);
    expect(initialCombatant('boss')).toMatchObject({ gold: 10, supplies: { stims: 0, slots: 1, effectiveness: 0 } });
    expect(ITEMS).toBe(ITEMS_V3);
    expect(requireItem('warhammer').cost).toBe(45);
    expect(catalogFor('2.0.0')).toBe(ITEMS_V2);
    expect(itemForHistory('warhammer', '2.0.0').cost).toBe(40); // V2 history keeps its own prices
  });
  it('10 gold buys one stim; only into an empty slot', () => {
    const a = buySupply(rich(25), 'buy_stim');
    expect(a).toMatchObject({ gold: 15, supplies: { stims: 1, slots: 1, effectiveness: 0 } });
    expect(supplyProblem(a, 'buy_stim')).toMatch(/No empty stim slot/);
    expect(() => buySupply(a, 'buy_stim')).toThrow(RuleError);
    expect(supplyProblem(rich(9), 'buy_stim')).toMatch(/Not enough gold/);
  });
  it('upgrades cost 25, 30, 35 … per kind; slots max 4, effectiveness max 4', () => {
    let s = rich(1000);
    const slotCosts: number[] = [];
    while (!supplyProblem(s, 'upgrade_slots')) { slotCosts.push(supplyCost(s, 'upgrade_slots')); s = buySupply(s, 'upgrade_slots'); }
    expect(slotCosts).toEqual([25, 30, 35]);
    expect(suppliesOf(s).slots).toBe(4);
    const effCosts: number[] = [];
    while (!supplyProblem(s, 'upgrade_effectiveness')) { effCosts.push(supplyCost(s, 'upgrade_effectiveness')); s = buySupply(s, 'upgrade_effectiveness'); }
    expect(effCosts).toEqual([25, 30, 35, 40]);
    expect(s.gold).toBe(1000 - 90 - 130);
    expect(snapshotOf(s).supplies).toEqual({ stims: 0, slots: 4, effectiveness: 4 });
  });
  it('pre-V3 states (no supplies) read as 0 stims, 1 slot', () => {
    const { supplies: _s, ...old } = initialCombatant('player');
    expect(suppliesOf(old)).toEqual({ stims: 0, slots: 1, effectiveness: 0 });
    expect(snapshotOf(old).supplies).toBeUndefined();
  });
});
