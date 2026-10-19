/** V3 Phase A: statistics helpers and reproducibility of the V2 control baseline (sim/v3-baseline.ts). */
import { describe, expect, it } from 'vitest';
import { playInMemoryRun } from '../../src/sim/balance.js';
import { clusterBootstrap, entropy, mirrorRoundOne, reportFor, wilson } from '../../src/sim/v3-baseline.js';

describe('statistics helpers', () => {
  it('wilson interval brackets the proportion and narrows with n', () => {
    const small = wilson(5, 10);
    const big = wilson(500, 1000);
    expect(small.value).toBe(0.5);
    expect(small.lo).toBeLessThan(0.5);
    expect(small.hi).toBeGreaterThan(0.5);
    expect(big.hi - big.lo).toBeLessThan(small.hi - small.lo);
    expect(big.hi - big.lo).toBeCloseTo(0.062, 2); // ≈ ±3.1 pp at n = 1000
    expect(wilson(0, 20).lo).toBe(0);
    expect(wilson(20, 20).hi).toBe(1);
  });
  it('cluster bootstrap is seeded (reproducible) and returns the pooled ratio', () => {
    const clusters = [{ num: 3, den: 4 }, { num: 1, den: 4 }, { num: 4, den: 4 }, { num: 0, den: 0 }];
    const a = clusterBootstrap(clusters, 's', 500);
    const b = clusterBootstrap(clusters, 's', 500);
    expect(a).toEqual(b);
    expect(a.value).toBeCloseTo(8 / 12);
    expect(a.n).toBe(12);
    expect(a.lo).toBeLessThanOrEqual(a.value);
    expect(a.hi).toBeGreaterThanOrEqual(a.value);
  });
  it('entropy: one category = 0 bits, two equal = 1 bit', () => {
    expect(entropy({ a: 7 })).toBe(0);
    expect(entropy({ a: 3, b: 3 })).toBeCloseTo(1);
  });
});

describe('baseline report', () => {
  it('same seeds → identical report', () => {
    const run = () => reportFor('melee_bruiser', [0, 1].map((i) => playInMemoryRun('melee_bruiser', `t:${i}`, 3)), 't');
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
  it('mirror round-1 check counts every seed', () => {
    const m = mirrorRoundOne(4, 't');
    expect(m.n).toBe(4);
    expect(m.bossWin.n).toBe(4);
    expect(m.dexTieRounds + m.fasterSide.boss + m.fasterSide.player).toBe(4);
  });
});
