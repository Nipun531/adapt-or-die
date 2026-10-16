/**
 * Unit tests for the combat engine: opening ranged priority, turn order, DEX bonus attacks per turn,
 * piercing, reproducibility from a seed, pause/resume for player choices, and audit fields.
 */
import { describe, expect, it } from 'vitest';
import { advanceCombat, resolveAttack, runFullCombat, startCombat, type Chooser } from '../../src/game/combat.js';
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

describe('opening ranged attack (plan §5)', () => {
  it('only fighters with a ranged weapon get an opening attack', () => {
    const { events } = runFullCombat(fighter('player', { hand1: 'bow' }), fighter('boss', { hand1: 'sword' }), 7, choosers);
    const openers = events.filter((e) => e.phase === 'opening');
    expect(openers.map((e) => e.attacker)).toEqual(['player']);
    expect(openers[0].mode).toBe('ranged');
  });
  it('both ranged → higher effective DEX shoots first', () => {
    const s = startCombat(fighter('player', { hand1: 'bow' }), fighter('boss', { hand1: 'bow' }, { dex: 20 }), 7);
    expect(s.initiative.openingOrder).toEqual(['boss', 'player']);
  });
  it('equal DEX → seeded coin flip decides, recorded', () => {
    const s = startCombat(fighter('player', { hand1: 'bow' }), fighter('boss', { hand1: 'bow' }), 7);
    expect(s.initiative.dexTie).toBe(true);
    expect(s.initiative.openingOrder[0]).toBe(s.initiative.tieWinner);
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

describe('piercing', () => {
  const att = fighter('player', { hand1: 'crossbow' });
  const def = fighter('boss', { armour: 'heavy_armour' });
  it('successful pierce ignores weapon % of Net DEF', () => {
    const c = resolveAttack(att, def, 'ranged', new ScriptedRng([0.1, 0.5]));
    expect(c.pierce!.success).toBe(true);
    expect(c.defUsed).toBeCloseTo(def.derived.netDef * 0.5);
  });
  it('failed pierce uses full Net DEF', () => {
    const c = resolveAttack(att, def, 'ranged', new ScriptedRng([0.9, 0.5]));
    expect(c.pierce!.success).toBe(false);
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
  const b = fighter('boss', { hand1: 'axe', hand2: 'wood_shield' });
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
