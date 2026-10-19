/** V3 mechanics lab (sim/v3-lab.ts) and the tuning knobs it sweeps. */
import { describe, expect, it } from 'vitest';
import { dodgeChanceFor } from '../../src/game/combat.js';
import { snapshotOf } from '../../src/game/derive.js';
import { loadoutProblem } from '../../src/game/equipment.js';
import { dodgeChance, stunGain } from '../../src/game/formulas.js';
import { initialCombatant } from '../../src/game/progression.js';
import { RULES_V2, RULES_V3, withRules } from '../../src/game/rules.js';
import { LAB_STAGES, makePopulation, runLab } from '../../src/sim/v3-lab.js';

const snap = (dex: number) => {
  const b = initialCombatant('player');
  return snapshotOf({ ...b, stats: { ...b.stats, dex } });
};

describe('tuning knobs', () => {
  it('dodge base and signed delta', () => {
    expect(dodgeChance(10, 0.02, 0.7, 0.1)).toBeCloseTo(0.3);
    expect(dodgeChance(-10, 0.02, 0.7, 0.1)).toBeCloseTo(0.1); // owner rule floors the delta
    expect(dodgeChance(-10, 0.02, 0.7, 0.1, true)).toBe(0); // signed: a slower defender dodges below base
    expect(dodgeChance(-2, 0.02, 0.7, 0.1, true)).toBeCloseTo(0.06);
    const fast = snap(30), slow = snap(20);
    const signed = withRules(RULES_V3, { v3: { dodge: { base: 0.15, delta: 'signed' } } });
    expect(dodgeChanceFor(fast, slow, signed)).toBeCloseTo(0.35);
    expect(dodgeChanceFor(slow, fast, signed)).toBe(0);
    expect(dodgeChanceFor(slow, fast, RULES_V3)).toBeCloseTo(0.1); // tuned default: 10% base, no DEX lead
    expect(dodgeChanceFor(fast, slow, RULES_V3)).toBeCloseTo(0.3); // + 2% per point of lead
  });
  it('stun gain scale, boost scale and sum cap', () => {
    expect(stunGain(0.3, 0.35, 0.12, 20, 20)).toBeCloseTo(35.4);
    expect(stunGain(0.6, 0.5, 0.36, 10, 10, 1.5)).toBeCloseTo(24.6);
  });
});

describe('lab population', () => {
  it('every generated build is legal, within budget, and reproducible', () => {
    for (const st of LAB_STAGES) {
      const a = makePopulation(st, 200, 50, 't');
      const b = makePopulation(st, 200, 50, 't');
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      for (const x of a.builds) {
        const lo = x.snap.loadout;
        expect(loadoutProblem(lo, [lo.hand1, lo.hand2, lo.armour].filter(Boolean) as string[])).toBeNull();
        expect(x.spent).toBeLessThanOrEqual(st.budget);
        expect(Object.values(x.allocation).reduce((s, v) => s + (v ?? 0), 0)).toBe(st.points);
      }
      // varied: several hand shapes and all defence styles appear
      expect(new Set(a.builds.map((x) => x.shape)).size).toBeGreaterThanOrEqual(5);
      expect(new Set(a.builds.map((x) => x.style.defense)).size).toBe(5);
    }
  });
  it('paired: the same population gives identical metrics; v2 has no V3 activity', () => {
    const pop = makePopulation(LAB_STAGES[1], 120, 400, 't');
    expect(JSON.stringify(runLab(pop, RULES_V3))).toBe(JSON.stringify(runLab(pop, RULES_V3)));
    const v2 = runLab(pop, RULES_V2);
    expect(v2.blockRate.n).toBe(0);
    expect(v2.stunsPerFight).toBe(0);
    expect(v2.stalls).toBe(0);
  });
});
