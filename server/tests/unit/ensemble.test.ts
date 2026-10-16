/**
 * Ensemble candidate + reactive agents (no database): blend arithmetic, the decision-outcome verdict, and that the
 * reactive agent's style is reproducible and depends only on what a player could observe.
 */
import { describe, expect, it } from 'vitest';
import { initialCombatant } from '../../src/game/progression.js';
import { Rng } from '../../src/game/rng.js';
import { decisionVerdict, DECISION_RULE, type Outcomes } from '../../src/ml/decision-check.js';
import { blendProbability } from '../../src/ml/predictor.js';
import { reactive, reactivePersona, reactiveStyle, type RoundOutcome } from '../../src/sim/agents.js';
import { baselinePredict, playInMemoryRun, playInMemoryRunWith } from '../../src/sim/balance.js';

describe('ensemble blend', () => {
  it('p = w·model + (1−w)·baseline; a baseline with no evidence counts as 0.5', () => {
    expect(blendProbability(0.9, 0.1, 0.3)).toBeCloseTo(0.3 * 0.9 + 0.7 * 0.1);
    expect(blendProbability(0.9, null, 0.3)).toBeCloseTo(0.3 * 0.9 + 0.7 * 0.5);
    expect(blendProbability(0.9, 0.1, 1)).toBeCloseTo(0.9);
  });
});

describe('decision-outcome verdict', () => {
  const o = (pooled: number, mirror: number): Outcomes[string] => ({
    pooledMargin: pooled, pooledWinRate: 0.9, byStrategy: [{ strategy: 'mirror', rounds: 60, meanMargin: mirror, bossWinRate: 0.5 }],
  });
  it('passes when the boss decides at least as well as with the baseline (within the allowed drop)', () => {
    expect(decisionVerdict({ baseline: o(0.5, 0.1), ensemble: o(0.5 - DECISION_RULE.maxPooledDrop, 0.1 - DECISION_RULE.maxUnseenDrop) }, 'ensemble').ok).toBe(true);
  });
  it('fails on a pooled drop or an unseen-style drop beyond the limits', () => {
    expect(decisionVerdict({ baseline: o(0.5, 0.1), ensemble: o(0.47, 0.1) }, 'ensemble').ok).toBe(false);
    expect(decisionVerdict({ baseline: o(0.5, 0.1), ensemble: o(0.5, 0.05) }, 'ensemble').ok).toBe(false);
  });
});

describe('reactive agent (sim-2.2.0)', () => {
  it('persona is fixed per run seed and varies across runs', () => {
    expect(reactivePersona('run-a')).toEqual(reactivePersona('run-a'));
    const set = new Set(Array.from({ length: 40 }, (_, i) => JSON.stringify(reactivePersona(`run-${i}`))));
    expect(set.size).toBeGreaterThan(20);
  });
  it('style depends only on observed outcomes (results, boss gear) and the persona', () => {
    const p = { ...reactivePersona('x'), start: 'melee' as const, lossesToSwitch: 1, counterBoss: 0, noise: 0 };
    const lost: RoundOutcome = { roundNumber: 1, winner: 'boss', bossLoadout: { hand1: 'sword', hand2: null, armour: null } };
    expect(reactiveStyle(p, [], 'x')).toBe('melee');
    expect(reactiveStyle(p, [lost], 'x')).toBe('ranged'); // switches after one loss
    const counter = { ...p, lossesToSwitch: 99, counterBoss: 1 };
    expect(reactiveStyle(counter, [{ ...lost, bossLoadout: { hand1: 'bow', hand2: null, armour: null } }], 'x')).toBe('melee');
    expect(reactiveStyle(counter, [{ ...lost, bossLoadout: { hand1: 'sword', hand2: 'great_shield', armour: null } }], 'x')).toBe('ranged');
  });
  it('produces legal decisions and only goes ranged when it can afford a weapon', () => {
    const d = reactive.decide({ roundNumber: 2, state: { ...initialCombatant('player'), statPoints: 0, gold: 5 }, history: [], rng: new Rng(1), runSeed: 'r' });
    expect(d.purchases.every((id) => id !== 'bow')).toBe(true);
  });
});

describe('paired in-memory runs', () => {
  it('the async driver with the baseline predictor reproduces the sync run exactly', async () => {
    const a = playInMemoryRun('reactive', 'pair:1', 3);
    const b = await playInMemoryRunWith('reactive', 'pair:1', async (req) => baselinePredict(req), 3);
    expect(b.rounds.map((r) => [r.winner, r.bossMargin])).toEqual(a.rounds.map((r) => [r.winner, r.bossMargin]));
  });
});
