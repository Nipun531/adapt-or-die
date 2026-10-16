/**
 * Unit tests pinning the game-plan rules: stats, catalogue, formulas, DEX clamp, bonus attacks,
 * XP curve, rewards/level-ups, stat allocation, equipment slots and purchases.
 * If a test here fails after a rule change, update docs/GAME_MECHANICS.md together with the test.
 */
import { describe, expect, it } from 'vitest';
import { ITEMS, getItem } from '../../src/game/catalog.js';
import { BASE_STATS, INITIAL_STAT_POINTS, LEVEL_UP_INCREASE, STAT_ALLOCATION_INCREASE } from '../../src/game/constants.js';
import { deriveStats, attackModesFor } from '../../src/game/derive.js';
import { allocateStat, equip, isLegalLoadout, purchase, RuleError } from '../../src/game/equipment.js';
import {
  dexBonusAttacks, dexMitigation, dexRatio, defAfterPierce, effectiveDex, finalDamage,
  mitigationRollFromUniform, netAtk, netDamage, netDef, netDex, rawDexMitigation, xpToNextLevel,
} from '../../src/game/formulas.js';
import { applyRoundRewards, initialCombatant } from '../../src/game/progression.js';
import type { CombatantState } from '../../src/game/types.js';

describe('core attributes (plan §1)', () => {
  it('starting values', () => expect(BASE_STATS).toEqual({ hp: 100, str: 20, def: 10, dex: 10 }));
  it('level-up increases', () => expect(LEVEL_UP_INCREASE).toEqual({ hp: 5, str: 2, def: 1, dex: 1 }));
  it('stat-allocation increases', () => expect(STAT_ALLOCATION_INCREASE).toEqual({ hp: 5, str: 3, def: 2, dex: 2 }));
});

describe('equipment catalogue (plan §7, §8)', () => {
  const table: [string, number, number, number, number][] = [
    ['knife', 5, 3, 0, 2], ['knuckle', 3, 1, 0, 2], ['sword', 10, 6, 2, 0], ['rapier', 20, 5, 2, 2],
    ['greatsword', 30, 10, 4, -2], ['wooden_club', 7, 4, 2, -1], ['iron_club', 15, 8, 4, -3], ['axe', 10, 5, 1, 1],
    ['bow', 12, 0, 0, 2], ['crossbow', 25, 0, 0, 4],
    ['leather_armour', 10, 0, 2, 0], ['light_armour', 25, 0, 4, -1], ['heavy_armour', 50, 0, 8, -4],
    ['wood_shield', 8, 0, 3, -1], ['small_shield', 18, 1, 6, -3], ['great_shield', 36, 2, 10, -5],
  ];
  it.each(table)('%s cost %i, STR %i, DEF %i, DEX %i', (id, cost, str, def, dex) => {
    const item = getItem(id)!;
    expect(item.cost).toBe(cost);
    expect(item.mods).toEqual({ str, def, dex });
  });
  it('contains exactly the plan items (no invented equipment)', () => expect(ITEMS.length).toBe(table.length));
  it('bow/crossbow pierce values are flagged placeholders', () => {
    expect(getItem('bow')!.pierce).toEqual({ chance: 0.2, defIgnore: 0.25, placeholder: true });
    expect(getItem('crossbow')!.pierce).toEqual({ chance: 0.3, defIgnore: 0.5, placeholder: true });
  });
});

describe('formulas (plan §3, §5)', () => {
  it('Net ATK = ATK + 0.25 × (ATK × mods)', () => expect(netAtk(20, 6)).toBe(50));
  it('Net DEF = DEF + 0.5 × (DEF × mods)', () => expect(netDef(10, 8)).toBe(50));
  it('Net DEX = DEX + 0.25 × (DEX × mods)', () => expect(netDex(10, 2)).toBe(15));
  it('Net DEX can go negative; effective DEX floors at 1', () => {
    expect(netDex(10, -9)).toBe(-12.5);
    expect(effectiveDex(-12.5)).toBe(1);
    expect(effectiveDex(15)).toBe(15);
  });
  it('net damage = ATK × ATK/(ATK+DEF)', () => {
    expect(netDamage(50, 50)).toBe(25);
    expect(netDamage(20, 10)).toBeCloseTo(13.3333, 4);
  });
  it('mitigation roll maps [0,1) onto [0.20,0.50)', () => {
    expect(mitigationRollFromUniform(0)).toBe(0.2);
    expect(mitigationRollFromUniform(0.5)).toBeCloseTo(0.35);
  });
  it('DEX mitigation = roll × (1 − 1/ratio) when defender faster', () => {
    expect(dexRatio(20, 10)).toBe(2);
    expect(dexMitigation(2, 0.4)).toBeCloseTo(0.2);
  });
  it('DEX mitigation clamps to 0 when defender has no DEX advantage', () => {
    expect(rawDexMitigation(0.5, 0.4)).toBeCloseTo(-0.4);
    expect(dexMitigation(0.5, 0.4)).toBe(0);
    expect(dexMitigation(1, 0.5)).toBe(0);
  });
  it('final damage = net × (1 − mitigation)', () => expect(finalDamage(25, 0.2)).toBe(20));
  it('pierce reduces DEF used by ignore %', () => expect(defAfterPierce(40, 0.25)).toBe(30));
});

describe('DEX bonus attacks (plan §4)', () => {
  it.each([[0, 0], [14, 0], [15, 1], [29, 1], [30, 2], [80, 2], [-20, 0]])('advantage %i → +%i', (adv, n) => {
    expect(dexBonusAttacks(10 + adv, 10)).toBe(n);
  });
});

describe('XP curve (plan §2)', () => {
  it('100, 112, 125, ... (1.12 multiplier, rounded)', () => {
    expect([1, 2, 3, 4, 5].map(xpToNextLevel)).toEqual([100, 112, 125, 140, 157]);
  });
});

describe('rewards and level-ups (plan §2)', () => {
  it('win: +50 XP +10 gold; loss: +20 XP +4 gold', () => {
    expect(applyRoundRewards(initialCombatant('player'), true).state).toMatchObject({ xp: 50, gold: 10, level: 1 });
    expect(applyRoundRewards(initialCombatant('boss'), false).state).toMatchObject({ xp: 20, gold: 4, level: 1 });
  });
  it('level-up: automatic increases, +1 stat point, +25 gold, surplus XP carries', () => {
    // statPoints: 0 = mid-run state with the initial points already spent, so only the level-up point is counted.
    const start: CombatantState = { ...initialCombatant('player'), statPoints: 0, xp: 70 };
    const r = applyRoundRewards(start, true); // 120 XP → level 2 with 20 surplus
    expect(r.levelUps).toBe(1);
    expect(r.state).toMatchObject({ level: 2, xp: 20, gold: 35, statPoints: 1 });
    expect(r.state.stats).toEqual({ hp: 105, str: 22, def: 11, dex: 11 });
  });
  it('multiple level-ups resolve in one reward', () => {
    const r = applyRoundRewards({ ...initialCombatant('player'), statPoints: 0, xp: 190 }, true); // 240 → L2 (−100) → 140 → L3 (−112) → 28
    expect(r.state).toMatchObject({ level: 3, xp: 28, statPoints: 2, gold: 60 });
  });
});

describe('stat allocation', () => {
  const s = { ...initialCombatant('player'), statPoints: 2 };
  it('applies per-point increase', () => {
    expect(allocateStat(s, 'str', 2).stats.str).toBe(26);
    expect(allocateStat(s, 'hp', 1).stats.hp).toBe(105);
    expect(allocateStat(s, 'dex', 1).statPoints).toBe(1);
  });
  it('rejects overspending and invalid amounts', () => {
    expect(() => allocateStat(s, 'def', 3)).toThrow(RuleError);
    expect(() => allocateStat(s, 'def', 0)).toThrow(RuleError);
    expect(() => allocateStat(s, 'def', 1.5)).toThrow(RuleError);
  });
});

describe('equipment slots & economy (plan §6)', () => {
  const inv = ['sword', 'axe', 'bow', 'crossbow', 'wood_shield', 'small_shield', 'leather_armour'];
  const L = (hand1: string | null, hand2: string | null, armour: string | null = null) => ({ hand1, hand2, armour });
  it('allows Shield+Melee, Shield+Ranged, Ranged+Melee, single, empty, plus armour slot', () => {
    for (const l of [L('wood_shield', 'sword'), L('bow', 'wood_shield'), L('bow', 'axe', 'leather_armour'), L('sword', null), L(null, null)]) {
      expect(isLegalLoadout(l, inv)).toBe(true);
    }
  });
  it('rejects Melee+Melee, Ranged+Ranged, Shield+Shield, armour in hand, unowned items', () => {
    for (const l of [L('sword', 'axe'), L('bow', 'crossbow'), L('wood_shield', 'small_shield'), L('leather_armour', null), L('rapier', null), L(null, null, 'sword')]) {
      expect(isLegalLoadout(l, inv)).toBe(false);
    }
  });
  it('purchase deducts gold; cannot overspend or rebuy', () => {
    const st = { ...initialCombatant('player'), gold: 12 };
    const after = purchase(st, 'bow');
    expect(after.gold).toBe(0);
    expect(after.inventory).toEqual(['bow']);
    expect(() => purchase(after, 'knuckle')).toThrow(/Not enough gold/);
    expect(() => purchase({ ...after, gold: 50 }, 'bow')).toThrow(/already owned/);
    expect(() => equip(st, L('bow', null))).toThrow(RuleError);
  });
});

describe('derived stats', () => {
  it('sums modifiers of all equipped gear', () => {
    const d = deriveStats(BASE_STATS, { hand1: 'small_shield', hand2: 'sword', armour: 'heavy_armour' });
    expect(d.strModSum).toBe(7);
    expect(d.defModSum).toBe(16);
    expect(d.dexModSum).toBe(-7);
    expect(d.netAtk).toBe(20 + 0.25 * 20 * 7);
    expect(d.netDef).toBe(10 + 0.5 * 10 * 16);
    expect(d.netDexRaw).toBe(10 + 0.25 * 10 * -7);
    expect(d.effDex).toBe(1);
  });
  it('attack modes by loadout', () => {
    expect(attackModesFor({ hand1: 'bow', hand2: 'sword', armour: null })).toEqual(['ranged', 'melee']);
    expect(attackModesFor({ hand1: 'bow', hand2: 'wood_shield', armour: null })).toEqual(['ranged']);
    expect(attackModesFor({ hand1: 'axe', hand2: null, armour: null })).toEqual(['melee']);
    expect(attackModesFor({ hand1: 'wood_shield', hand2: null, armour: null })).toEqual(['unarmed']);
  });
});

describe('initial stat points (engine 1.1.0)', () => {
  it('both sides start level 1, 0 gold, base stats, no items and exactly 2 unallocated points', () => {
    expect(INITIAL_STAT_POINTS).toBe(2);
    for (const side of ['player', 'boss'] as const) {
      const s = initialCombatant(side);
      expect(s).toMatchObject({ level: 1, xp: 0, gold: 0, statPoints: 2, inventory: [] });
      expect(s.stats).toEqual(BASE_STATS);
    }
  });
  it('are spent with the normal allocation increments and cannot be overspent', () => {
    const s = initialCombatant('player');
    expect(allocateStat(allocateStat(s, 'dex', 1), 'hp', 1)).toMatchObject({ statPoints: 0, stats: { hp: 105, str: 20, def: 10, dex: 12 } });
    expect(allocateStat(s, 'def', 2).stats.def).toBe(14);
    expect(() => allocateStat(s, 'str', 3)).toThrow(RuleError);
    expect(() => allocateStat(allocateStat(s, 'str', 2), 'str', 1)).toThrow(/Not enough stat points/);
  });
});
