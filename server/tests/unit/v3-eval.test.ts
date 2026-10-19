/** Statistics used by the Phase D boss evaluation (sim/v3-eval-cli.ts). */
import { describe, expect, it } from 'vitest';
import { chiSquare, chiSquareP, jsDivergence } from '../../src/sim/v3-eval-cli.js';

describe('evaluation statistics', () => {
  it('chi-square p-value approximation matches table values', () => {
    expect(chiSquareP(3.841, 1)).toBeCloseTo(0.05, 2);
    expect(chiSquareP(9.21, 2)).toBeCloseTo(0.01, 2);
    expect(chiSquareP(18.31, 10)).toBeCloseTo(0.05, 2);
  });
  it('independent rows → high p; very different rows → tiny p', () => {
    expect(chiSquare([[50, 50], [50, 50]]).p).toBeGreaterThan(0.5);
    expect(chiSquare([[90, 10], [10, 90]]).p).toBeLessThan(1e-6);
    expect(chiSquare([[10, 0, 5], [10, 0, 5]]).df).toBe(1); // empty column dropped
  });
  it('JS divergence: 0 for equal, 1 for disjoint', () => {
    expect(jsDivergence({ a: 2, b: 2 }, { a: 5, b: 5 })).toBeCloseTo(0);
    expect(jsDivergence({ a: 3 }, { b: 3 })).toBeCloseTo(1);
  });
});
