/**
 * Unit tests for the combat engine: opening ranged priority, turn order, DEX bonus attacks per turn,
 * piercing, reproducibility from a seed, pause/resume for player choices, and audit fields.
 */
import { describe, expect, it } from 'vitest';
import { advanceCombat, openingShooters, resolveAttack, runFullCombat, startCombat, type Chooser } from '../../src/game/combat.js';
import { requireItem } from '../../src/game/catalog.js';
import { netDamage } from '../../src/game/formulas.js';
import { snapshotOf } from '../../src/game/derive.js';
import { initialCombatant } from '../../src/game/progression.js';
import { Rng } from '../../src/game/rng.js';
import type { CombatantState, Loadout, Side } from '../../src/game/types.js';

function fighter(side: Side, loadout: Partial<Loadout>, stats: Partial<CombatantState['stats']> = {}) {
  const base = initialCombatant(side);
  const lo = { hand1: null, hand2: null, armour: null, ...loadout };
  const inv = [lo.hand1, lo.hand2, lo.armour].filter(Boolean) as string[];
  return snapshotOf({ ...base, stats: { ...base.stats, ...stats }, inventory: inv, loadout: lo });
}
const meleeFirst: Chooser = (c) => ({ mode: c.options.includes('melee') ? 'melee' : c.options[0], source: 'agent' });
const choosers = { player: meleeFirst, boss: meleeFirst };

/** Rng stub returning scripted values (to force pierce/mitigation outcomes). */
class ScriptedRng extends Rng {
  constructor(private values: number[]) { super(1); }
  next() { return this.values.shift() ?? 0.5; }
}

describe('opening shot (engine 2.0.0 rule)', () => {
  const openers = (p: ReturnType<typeof fighter>, b: ReturnType<typeof fighter>, seed = 7) =>
    runFullCombat(p, b, seed, choosers).events.filter((e) => e.phase === 'opening');

  it('neither ranged → no opening phase', () => {
    const s = startCombat(fighter('player', { hand1: 'sword' }), fighter('boss', {}), 7);
    expect(s.initiative).toMatchObject({ openingOrder: [], openingEligible: [], openingRule: 'none' });
    expect(openers(fighter('player', { hand1: 'sword' }), fighter('boss', {}))).toEqual([]);
  });
  it('only one ranged → it shoots, even when slower', () => {
    const p = fighter('player', { hand1: 'bow' });
    const b = fighter('boss', { hand1: 'sword' }, { dex: 40 });
    expect(startCombat(p, b, 7).initiative).toMatchObject({ openingOrder: ['player'], openingRule: 'single' });
    const o = openers(p, b);
    expect(o.map((e) => e.attacker)).toEqual(['player']);
    expect(o[0].mode).toBe('ranged');
  });
  it('both ranged → ONLY the higher effective DEX fighter shoots (boss faster)', () => {
    const p = fighter('player', { hand1: 'bow' });
    const b = fighter('boss', { hand1: 'bow' }, { dex: 20 });
    expect(startCombat(p, b, 7).initiative).toMatchObject({ openingOrder: ['boss'], openingEligible: ['player', 'boss'], openingRule: 'dex_advantage' });
    expect(openers(p, b).map((e) => e.attacker)).toEqual(['boss']);
  });
  it('both ranged → ONLY the higher effective DEX fighter shoots (player faster)', () => {
    const p = fighter('player', { hand1: 'crossbow' });
    const b = fighter('boss', { hand1: 'bow' });
    expect(openers(p, b).map((e) => e.attacker)).toEqual(['player']);
  });
  it('both ranged with equal effective DEX → nobody gets the opening shot', () => {
    const p = fighter('player', { hand1: 'bow' });
    const b = fighter('boss', { hand1: 'bow' });
    const s = startCombat(p, b, 7);
    expect(s.initiative).toMatchObject({ dexTie: true, openingOrder: [], openingRule: 'tie_none' });
    expect(openers(p, b)).toEqual([]);
  });
  it('a Ranged+Melee hybrid counts as eligible', () => {
    expect(openingShooters(fighter('player', { hand1: 'bow', hand2: 'sword' }), fighter('boss', {})).openingOrder).toEqual(['player']);
  });
  it('the turn-order coin flip is still drawn first, so no-opening rounds keep the RNG sequence', () => {
    // Tied bows (no opening shot) vs no bows: draw 1 = tie-break in both; the first regular attack's first draw
    // (pierce roll with a bow, mitigation unarmed) is draw 2 in both — no draws were spent on an opening phase.
    const plain = runFullCombat(fighter('player', {}), fighter('boss', {}), 11, choosers);
    const tied = runFullCombat(fighter('player', { hand1: 'bow' }), fighter('boss', { hand1: 'bow' }), 11, choosers);
    expect(tied.state.initiative.tieWinner).toBe(plain.state.initiative.tieWinner);
    expect(tied.events[0].phase).toBe('regular');
    expect(tied.events[0].calc.pierce!.roll).toBe(plain.events[0].calc.mitigationUniform);
  });
  it('an opening shot from a pierce bow rolls pierce', () => {
    const o = openers(fighter('player', { hand1: 'longbow' }), fighter('boss', {}));
    expect(o[0].calc.pierce).not.toBeNull();
    expect(o[0].calc.pierce!.weaponId).toBe('longbow');
  });
});

describe('turn order and DEX bonus attacks (plan §4)', () => {
  it('faster fighter acts first and gets bonus attacks every turn', () => {
    // player DEX 30 vs boss 10 → +1 (advantage 20)
    const { events } = runFullCombat(fighter('player', {}, { dex: 30 }), fighter('boss', {}, { hp: 400 }), 3, choosers);
    expect(events[0].attacker).toBe('player');
    const t1 = events.filter((e) => e.turn === 1);
    expect(t1.map((e) => `${e.attacker}:${e.phase}`)).toEqual(['player:regular', 'player:dex_bonus', 'boss:regular']);
    const t2 = events.filter((e) => e.turn === 2 && e.attacker === 'player');
    expect(t2.length).toBe(2);
  });
  it('advantage of 30 gives +2', () => {
    const s = startCombat(fighter('player', {}, { dex: 40 }), fighter('boss', {}), 1);
    expect(s.initiative.bonusAttacks).toEqual({ player: 2, boss: 0 });
  });
});

describe('piercing (any weapon with a pierce spec, engine 2.0.0)', () => {
  const att = fighter('player', { hand1: 'crossbow' });
  const def = fighter('boss', { armour: 'heavy_armour' });
  const xbow = requireItem('crossbow').pierce!;
  it('successful pierce ignores weapon % of Net DEF and records the extra damage', () => {
    const c = resolveAttack(att, def, 'ranged', new ScriptedRng([0, 0.5]));
    expect(c.pierce!.success).toBe(true);
    expect(c.pierce!.weaponId).toBe('crossbow');
    expect(c.defUsed).toBeCloseTo(def.derived.netDef * (1 - xbow.defIgnore));
    expect(c.pierce!.extraDamage).toBeCloseTo(c.netDamage - netDamage(c.attackValue, def.derived.netDef));
    expect(c.pierce!.extraDamage!).toBeGreaterThan(0);
  });
  it('success boundary is roll < chance', () => {
    expect(resolveAttack(att, def, 'ranged', new ScriptedRng([xbow.chance - 1e-9, 0.5])).pierce!.success).toBe(true);
    expect(resolveAttack(att, def, 'ranged', new ScriptedRng([xbow.chance, 0.5])).pierce!.success).toBe(false);
  });
  it.each(['rapier', 'flail', 'spear', 'lance', 'pike'])('melee pierce weapon %s rolls pierce on melee attacks', (id) => {
    const m = fighter('player', { hand1: id });
    const spec = requireItem(id).pierce!;
    const c = resolveAttack(m, def, 'melee', new ScriptedRng([0, 0.5]));
    expect(c.pierce).toMatchObject({ success: true, chance: spec.chance, defIgnore: spec.defIgnore, weaponId: id });
    expect(c.defUsed).toBeCloseTo(def.derived.netDef * (1 - spec.defIgnore));
    expect(c.attackValue).toBe(m.derived.netAtk);
  });
  it('weapons without a pierce spec and unarmed attacks draw NO pierce roll', () => {
    const rngA = new ScriptedRng([0.3, 0.9]);
    const c = resolveAttack(fighter('player', { hand1: 'sword' }), def, 'melee', rngA);
    expect(c.pierce).toBeNull();
    expect(c.mitigationUniform).toBe(0.3); // first draw went to mitigation
    expect(resolveAttack(fighter('player', {}), def, 'unarmed', new ScriptedRng([0.3])).pierce).toBeNull();
  });
  it('a Bow + Pike hybrid uses the pierce spec of the weapon actually used', () => {
    const h = fighter('player', { hand1: 'bow', hand2: 'pike' });
    expect(resolveAttack(h, def, 'ranged', new ScriptedRng([0, 0.5])).pierce!.weaponId).toBe('bow');
    expect(resolveAttack(h, def, 'melee', new ScriptedRng([0, 0.5])).pierce!.weaponId).toBe('pike');
  });
  it('failed pierce uses full Net DEF', () => {
    const c = resolveAttack(att, def, 'ranged', new ScriptedRng([0.99, 0.5]));
    expect(c.pierce!.success).toBe(false);
    expect(c.pierce!.extraDamage).toBe(0);
    expect(c.defUsed).toBe(def.derived.netDef);
  });
  it('ranged uses effective DEX as attack value; melee uses Net ATK', () => {
    expect(resolveAttack(att, def, 'ranged', new ScriptedRng([0.9, 0.5])).attackValue).toBe(att.derived.effDex);
    const m = fighter('player', { hand1: 'sword' });
    expect(resolveAttack(m, def, 'melee', new ScriptedRng([0.5])).attackValue).toBe(m.derived.netAtk);
  });
  it('calc is auditable: final = net × (1 − mitigation)', () => {
    const c = resolveAttack(att, def, 'ranged', new ScriptedRng([0.9, 0.3]));
    expect(c.netDamage).toBeCloseTo(c.attackValue * (c.attackValue / (c.attackValue + c.defUsed)));
    expect(c.finalDamage).toBeCloseTo(c.netDamage * (1 - c.mitigation));
  });
});

describe('reproducibility and pause/resume', () => {
  const p = fighter('player', { hand1: 'bow', hand2: 'sword' });
  const b = fighter('boss', { hand1: 'mace', hand2: 'wood_shield' });
  it('same seed + same choices → identical events', () => {
    const a = runFullCombat(p, b, 42, choosers).events;
    const c = runFullCombat(p, b, 42, choosers).events;
    expect(c).toEqual(a);
  });
  it('pauses for a hybrid player choice and resumes to the same result as an uninterrupted run', () => {
    const waiting = { player: () => null, boss: meleeFirst } as Record<Side, Chooser>;
    let res = advanceCombat(startCombat(p, b, 42), waiting);
    expect(res.state.pending?.options).toEqual(['ranged', 'melee']);
    const all = [...res.events];
    let guard = 0;
    while (res.state.winner === null && guard++ < 500) {
      res = advanceCombat(JSON.parse(JSON.stringify(res.state)), waiting, { provided: { side: 'player', mode: 'melee' } });
      all.push(...res.events);
    }
    const direct = runFullCombat(p, b, 42, choosers).events;
    expect(all.map((e) => e.damage)).toEqual(direct.map((e) => e.damage));
  });
  it('repeat choice auto-applies for rest of round', () => {
    const waiting = { player: () => null, boss: meleeFirst } as Record<Side, Chooser>;
    const first = advanceCombat(startCombat(p, b, 42), waiting);
    const res = advanceCombat(first.state, waiting, { provided: { side: 'player', mode: 'ranged', repeat: true } });
    expect(res.state.winner).not.toBeNull();
    expect(res.events.filter((e) => e.attacker === 'player').every((e) => e.mode === 'ranged')).toBe(true);
  });
  it('rejects a choice that is not available', () => {
    const waiting = { player: () => null, boss: meleeFirst } as Record<Side, Chooser>;
    const first = advanceCombat(startCombat(p, b, 42), waiting);
    expect(() => advanceCombat(first.state, waiting, { provided: { side: 'player', mode: 'unarmed' } })).toThrow();
  });
});
