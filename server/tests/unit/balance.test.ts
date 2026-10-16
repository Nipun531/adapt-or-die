/**
 * Balance harness (no DB): reproducibility, catalogue restoration after experiments, and run legality.
 */
import { describe, expect, it } from 'vitest';
import { getItem } from '../../src/game/catalog.js';
import { duel, opponent, playInMemoryRun, robustBuildFor, TIERS, withItems, withPierce } from '../../src/sim/balance.js';

describe('balance harness', () => {
  it('in-memory runs are reproducible for a seed and obey the round-1 rule', () => {
    const a = playInMemoryRun('piercer', 'unit:1', 3);
    const b = playInMemoryRun('piercer', 'unit:1', 3);
    expect(a.rounds.map((r) => r.winner)).toEqual(b.rounds.map((r) => r.winner));
    expect(a.rounds.length).toBe(3);
    // the boss spends its 2 initial points in round 1 (allocation recorded on the plan)
    expect(Object.values(a.rounds[0].bossAllocation).reduce((s, n) => s + (n ?? 0), 0)).toBe(2);
    // every equipped item was legal and owned (equip() would have thrown otherwise); gold never negative
    expect(a.player.gold).toBeGreaterThanOrEqual(0);
    expect(a.boss.gold).toBeGreaterThanOrEqual(0);
  });

  it('the mirror player runs with the boss policy', () => {
    const r = playInMemoryRun('mirror', 'unit:m', 2);
    expect(r.rounds.length).toBe(2);
  });

  it('experiments restore the live catalogue afterwards', () => {
    const before = JSON.stringify(getItem('pike'));
    withItems({ pike: { cost: 1, mods: { str: 99 }, pierce: { chance: 1, defIgnore: 1 } } }, () => {
      expect(getItem('pike')!.mods.str).toBe(99);
    });
    withPierce({ pike: { chance: 0.99, defIgnore: 0.99 } }, () => expect(getItem('pike')!.pierce!.chance).toBe(0.99));
    expect(JSON.stringify(getItem('pike'))).toBe(before);
  });

  it('duels are deterministic and margins stay in [−1, 1]', () => {
    const t = TIERS[1];
    const opp = opponent('knight', t);
    const me = robustBuildFor('lance', t);
    const x = duel(me, opp, 20, 's');
    expect(duel(me, opp, 20, 's')).toEqual(x);
    expect(x.margin).toBeGreaterThanOrEqual(-1);
    expect(x.margin).toBeLessThanOrEqual(1);
  });
});
