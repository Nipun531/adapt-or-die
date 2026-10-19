/**
 * Unit tests pinning the game-plan rules: stats, catalogue, formulas, DEX clamp, bonus attacks,
 * XP curve, rewards/level-ups, stat allocation, equipment slots and purchases.
 * If a test here fails after a rule change, update docs/GAME_MECHANICS.md together with the test.
 */
import { describe, expect, it } from 'vitest';
import { ITEMS, ITEMS_V1, ITEMS_V2, catalogFor, cheapestCost, getItem, itemForHistory } from '../../src/game/catalog.js';
import { BASE_STATS, ENGINE_VERSION, GOLD_LEVEL_UP, GOLD_LOSS, GOLD_WIN, INITIAL_STAT_POINTS, LEVEL_UP_INCREASE, STARTING_GOLD, STAT_ALLOCATION_INCREASE, XP_LOSS, XP_WIN } from '../../src/game/constants.js';
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

describe('equipment catalogue V2 (V2_DEMANDS §2.1, engine 2.0.0 — frozen for history; V3 = this + Warhammer 45, see v3-combat.test)', () => {
  // [id, display name, category, cost, STR, DEF, DEX, has pierce]  — costs and modifiers are the user's exact values.
  const table: [string, string, string, number, number, number, number, boolean][] = [
    ['knuckle', 'Knuckle', 'melee', 3, 1, 0, 2, false], ['knife', 'Knife', 'melee', 5, 2, 0, 2, false],
    ['sword', 'Sword', 'melee', 10, 4, 1, 0, false], ['longsword', 'LongSword', 'melee', 20, 7, 2, 0, false],
    ['sabre', 'Sabre', 'melee', 20, 5, 1, 2, false], ['greatsword', 'GreatSword', 'melee', 40, 10, 3, -2, false],
    ['rapier', 'Rapier', 'melee', 40, 6, 1, 3, true], ['wooden_club', 'Wooden Club', 'melee', 7, 3, 1, 0, false],
    ['iron_club', 'Iron Club', 'melee', 15, 5, 2, -1, false], ['mace', 'Mace', 'melee', 25, 8, 2, -1, false],
    ['flail', 'Flail', 'melee', 30, 4, 1, 0, true], ['warhammer', 'Warhammer', 'melee', 40, 12, 2, -3, false],
    ['bow', 'Bow', 'ranged', 15, 0, 0, 2, true], ['crossbow', 'Crossbow', 'ranged', 28, 0, 0, 4, true],
    ['longbow', 'Longbow', 'ranged', 42, 0, 0, 3, true], ['spear', 'Spear', 'melee', 15, 3, 0, 1, true],
    ['lance', 'Lance', 'melee', 28, 5, 0, 0, true], ['pike', 'Pike', 'melee', 42, 7, 0, -1, true],
    ['leather_armour', 'Leather Armor', 'armour', 10, 0, 2, 0, false], ['light_armour', 'Light Armor', 'armour', 25, 0, 4, -1, false],
    ['heavy_armour', 'Heavy Armor', 'armour', 45, 0, 8, -4, false], ['wood_shield', 'Wood Shield', 'shield', 8, 0, 3, -1, false],
    ['small_shield', 'Small Shield', 'shield', 20, 0, 5, -2, false], ['great_shield', 'Great Shield', 'shield', 42, 1, 8, -5, false],
  ];
  it.each(table)('%s "%s" %s cost %i, STR %i, DEF %i, DEX %i, pierce %s', (id, name, category, cost, str, def, dex, pierce) => {
    const item = ITEMS_V2.find((i) => i.id === id)!;
    expect(item).toMatchObject({ name, category, cost });
    expect(item.mods).toEqual({ str, def, dex });
    expect(Boolean(item.pierce)).toBe(pierce);
  });
  it('contains exactly the V2 items (no invented equipment)', () => expect(ITEMS.map((i) => i.id).sort()).toEqual(table.map((t) => t[0]).sort()));
  it('pierce specs are real (non-placeholder) probabilities', () => {
    for (const i of ITEMS.filter((x) => x.pierce)) {
      expect(i.pierce!.placeholder).toBe(false);
      expect(i.pierce!.chance).toBeGreaterThan(0);
      expect(i.pierce!.chance).toBeLessThanOrEqual(1);
      expect(i.pierce!.defIgnore).toBeGreaterThan(0);
      expect(i.pierce!.defIgnore).toBeLessThanOrEqual(1);
    }
  });
  it('polearms are melee (no First Shot); only bows are ranged', () => {
    expect(ITEMS.filter((i) => i.category === 'ranged').map((i) => i.id).sort()).toEqual(['bow', 'crossbow', 'longbow']);
    for (const id of ['spear', 'lance', 'pike']) expect(getItem(id)!).toMatchObject({ category: 'melee', family: 'polearm' });
  });
  it('cheapest ranged weapon costs 15 (Bow)', () => expect(cheapestCost('ranged')).toBe(15));
});

describe('legacy catalogue (engine 1.x, frozen)', () => {
  it('V1 table is unchanged (16 items incl. Axe, V1 values)', () => {
    expect(ITEMS_V1.length).toBe(16);
    expect(ITEMS_V1.find((i) => i.id === 'axe')).toMatchObject({ cost: 10, mods: { str: 5, def: 1, dex: 1 } });
    expect(ITEMS_V1.find((i) => i.id === 'sword')).toMatchObject({ cost: 10, mods: { str: 6, def: 2, dex: 0 } });
    expect(ITEMS_V1.find((i) => i.id === 'bow')!.pierce).toEqual({ chance: 0.2, defIgnore: 0.25, placeholder: true });
  });
  it('history lookups resolve against the record\'s engine catalogue', () => {
    expect(catalogFor('1.1.0')).toBe(ITEMS_V1);
    expect(catalogFor(ENGINE_VERSION)).toBe(ITEMS);
    expect(itemForHistory('sword', '1.1.0').mods.str).toBe(6);
    expect(itemForHistory('sword', '2.0.0').mods.str).toBe(4);
    expect(itemForHistory('axe', '1.0.0').name).toBe('Axe');
    expect(itemForHistory('axe', '2.0.0').name).toBe('Axe'); // falls back so old ids still display
    expect(getItem('axe')).toBeUndefined(); // but it is not purchasable / usable under live rules
    expect(() => itemForHistory('nope', '2.0.0')).toThrow();
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

describe('rewards and level-ups (V2 economy)', () => {
  it('constants: win 50 XP / 10 gold, loss 30 XP / 5 gold, level-up +20 gold', () => {
    expect({ XP_WIN, XP_LOSS, GOLD_WIN, GOLD_LOSS, GOLD_LEVEL_UP }).toEqual({ XP_WIN: 50, XP_LOSS: 30, GOLD_WIN: 10, GOLD_LOSS: 5, GOLD_LEVEL_UP: 20 });
  });
  it('win: +50 XP +10 gold; loss: +30 XP +5 gold', () => {
    expect(applyRoundRewards(initialCombatant('player'), true).state).toMatchObject({ xp: 50, gold: STARTING_GOLD + 10, level: 1 });
    expect(applyRoundRewards(initialCombatant('boss'), false).state).toMatchObject({ xp: 30, gold: STARTING_GOLD + 5, level: 1 });
  });
  it('a loss can now trigger a level-up (70 + 30 = 100 XP)', () => {
    const r = applyRoundRewards({ ...initialCombatant('player'), statPoints: 0, xp: 70 }, false);
    expect(r.state).toMatchObject({ level: 2, xp: 0, gold: STARTING_GOLD + 25, statPoints: 1 });
  });
  it('level-up: automatic increases, +1 stat point, +20 gold, surplus XP carries', () => {
    // statPoints: 0 = mid-run state with the initial points already spent, so only the level-up point is counted.
    const start: CombatantState = { ...initialCombatant('player'), statPoints: 0, xp: 70 };
    const r = applyRoundRewards(start, true); // 120 XP → level 2 with 20 surplus
    expect(r.levelUps).toBe(1);
    expect(r.state).toMatchObject({ level: 2, xp: 20, gold: STARTING_GOLD + 30, statPoints: 1 });
    expect(r.state.stats).toEqual({ hp: 105, str: 22, def: 11, dex: 11 });
  });
  it('multiple level-ups resolve in one reward', () => {
    const r = applyRoundRewards({ ...initialCombatant('player'), statPoints: 0, xp: 190 }, true); // 240 → L2 (−100) → 140 → L3 (−112) → 28
    expect(r.state).toMatchObject({ level: 3, xp: 28, statPoints: 2, gold: STARTING_GOLD + 50 });
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
  const inv = ['sword', 'pike', 'bow', 'crossbow', 'wood_shield', 'small_shield', 'leather_armour'];
  const L = (hand1: string | null, hand2: string | null, armour: string | null = null) => ({ hand1, hand2, armour });
  it('allows Shield+Melee, Shield+Ranged, Ranged+Melee, single, empty, plus armour slot', () => {
    for (const l of [L('wood_shield', 'sword'), L('bow', 'wood_shield'), L('bow', 'pike', 'leather_armour'), L('pike', 'wood_shield'), L('sword', null), L(null, null)]) {
      expect(isLegalLoadout(l, inv)).toBe(true);
    }
  });
  it('rejects Melee+Melee, Ranged+Ranged, Shield+Shield, armour in hand, unowned items', () => {
    for (const l of [L('sword', 'pike'), L('bow', 'crossbow'), L('wood_shield', 'small_shield'), L('leather_armour', null), L('rapier', null), L('axe', null), L(null, null, 'sword')]) {
      expect(isLegalLoadout(l, inv)).toBe(false);
    }
  });
  it('purchase deducts gold; cannot overspend or rebuy', () => {
    const st = { ...initialCombatant('player'), gold: 15 };
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
    expect(d.strModSum).toBe(4);
    expect(d.defModSum).toBe(14);
    expect(d.dexModSum).toBe(-6);
    expect(d.netAtk).toBe(20 + 0.25 * 20 * 4);
    expect(d.netDef).toBe(10 + 0.5 * 10 * 14);
    expect(d.netDexRaw).toBe(10 + 0.25 * 10 * -6);
    expect(d.effDex).toBe(1);
  });
  it('attack modes by loadout', () => {
    expect(attackModesFor({ hand1: 'bow', hand2: 'sword', armour: null })).toEqual(['ranged', 'melee']);
    expect(attackModesFor({ hand1: 'bow', hand2: 'wood_shield', armour: null })).toEqual(['ranged']);
    expect(attackModesFor({ hand1: 'pike', hand2: null, armour: null })).toEqual(['melee']);
    expect(attackModesFor({ hand1: 'wood_shield', hand2: null, armour: null })).toEqual(['unarmed']);
  });
});

describe('initial stat points (engine 1.1.0)', () => {
  it('both sides start level 1, 10 gold (V3), base stats, no items, no stims and exactly 2 unallocated points', () => {
    expect(INITIAL_STAT_POINTS).toBe(2);
    for (const side of ['player', 'boss'] as const) {
      const s = initialCombatant(side);
      expect(s).toMatchObject({ level: 1, xp: 0, gold: STARTING_GOLD, statPoints: 2, inventory: [], supplies: { stims: 0, slots: 1, effectiveness: 0 } });
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
