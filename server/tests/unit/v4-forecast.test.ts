/**
 * V4 next-build pieces: heads, legal candidates (real rules only), forecasters (uniform / persistence / profile /
 * oracle) and the planner's forecast scenarios.
 */
import { describe, expect, it } from 'vitest';
import { headsOf, HEAD_CLASSES, HEAD_NAMES, type Heads } from '../../src/boss/build-heads.js';
import { legalCandidates } from '../../src/boss/candidates.js';
import { candidateProbabilities, jointLogLoss, oneHotHeads, persistenceHeads, profileHeads, uniformHeads } from '../../src/boss/forecast.js';
import { forecastScenarios } from '../../src/boss/policy.js';
import { snapshotOf } from '../../src/game/derive.js';
import { allocateStat, equip, isLegalLoadout, purchase } from '../../src/game/equipment.js';
import { initialCombatant } from '../../src/game/progression.js';
import type { CombatantState } from '../../src/game/types.js';

const rich = (gold: number): CombatantState => ({ ...initialCombatant('player'), gold, statPoints: 2 });

describe('build heads', () => {
  it('label what the player chose: hands, melee family, armour change, dominant stat', () => {
    const prev = rich(60);
    let s = allocateStat(prev, 'dex', 2);
    s = purchase(purchase(s, 'bow'), 'sword');
    s = purchase(s, 'leather_armour');
    s = equip(s, { hand1: 'bow', hand2: 'sword', armour: 'leather_armour' });
    expect(headsOf(prev, snapshotOf(s))).toEqual({ hands: 'ranged_melee', family: 'blade', armour: 'upgrade', alloc: 'dex' });
    expect(headsOf(s, snapshotOf(s))).toEqual({ hands: 'ranged_melee', family: 'blade', armour: 'keep', alloc: 'none' });
  });
});

describe('legal candidates', () => {
  it('every candidate is a legal, affordable build made by the real rules, with unique heads', () => {
    for (const gold of [0, 10, 25, 60, 200]) {
      const obs = rich(gold);
      const cands = legalCandidates(obs);
      expect(cands.length).toBeGreaterThan(0);
      expect(new Set(cands.map((c) => c.key)).size).toBe(cands.length);
      for (const c of cands) {
        expect(c.state.gold).toBeGreaterThanOrEqual(0);
        expect(isLegalLoadout(c.state.loadout, c.state.inventory)).toBe(true);
        expect(headsOf(obs, c.snapshot)).toEqual(c.heads);
      }
      // With no gold and nothing owned, no candidate holds a weapon.
      if (gold === 0) expect(cands.every((c) => c.heads.hands === 'empty')).toBe(true);
    }
  });
  it('more gold → more reachable builds', () => {
    expect(legalCandidates(rich(200)).length).toBeGreaterThan(legalCandidates(rich(10)).length);
  });
});

describe('forecasters', () => {
  const H = (o: Partial<Heads>): Heads => ({ hands: 'melee', family: 'blade', armour: 'none', alloc: 'str', ...o });
  const sums = (p: ReturnType<typeof uniformHeads>) => HEAD_NAMES.map((h) => Object.values(p[h]).reduce((a, b) => a + b, 0));
  it('all forecasts are distributions; no history → uniform', () => {
    for (const f of [uniformHeads(), persistenceHeads([]), persistenceHeads([H({}), H({ hands: 'ranged' })]), profileHeads([], { previousWinner: null, lastHeads: null })]) {
      for (const s of sums(f)) expect(s).toBeCloseTo(1, 9);
    }
    expect(persistenceHeads([])).toEqual(uniformHeads());
    expect(profileHeads([], { previousWinner: 'boss', lastHeads: null })).toEqual(uniformHeads());
  });
  it('persistence favours repeating last round', () => {
    const p = persistenceHeads([H({ hands: 'ranged' }), H({ hands: 'melee' })]);
    expect(p.hands.melee).toBeGreaterThan(p.hands.ranged);
    expect(p.hands.melee).toBeGreaterThan(0.5);
  });
  it('profile: learns a habit, adapts after a switch, and uses the win/loss context', () => {
    const habit = Array.from({ length: 6 }, () => ({ heads: H({ hands: 'melee' }), previousWinner: 'boss' as const }));
    const p1 = profileHeads(habit, { previousWinner: 'boss', lastHeads: H({}) });
    expect(p1.hands.melee).toBeGreaterThan(0.6);
    const switched = [...habit, ...Array.from({ length: 3 }, () => ({ heads: H({ hands: 'ranged' }), previousWinner: 'boss' as const }))];
    const p2 = profileHeads(switched, { previousWinner: 'boss', lastHeads: H({ hands: 'ranged' }) });
    expect(p2.hands.ranged).toBeGreaterThan(p2.hands.melee); // recent change wins over the older habit
    // After wins they go ranged, after losses melee → the context decides.
    const ctx = [
      ...Array.from({ length: 4 }, () => ({ heads: H({ hands: 'ranged' }), previousWinner: 'player' as const })),
      ...Array.from({ length: 4 }, () => ({ heads: H({ hands: 'melee' }), previousWinner: 'boss' as const })),
    ];
    const afterWin = profileHeads(ctx, { previousWinner: 'player', lastHeads: null });
    const afterLoss = profileHeads(ctx, { previousWinner: 'boss', lastHeads: null });
    expect(afterWin.hands.ranged).toBeGreaterThan(afterLoss.hands.ranged);
  });
  it('candidate probabilities are renormalised over the legal set; the oracle gives the lowest joint loss', () => {
    const obs = rich(60);
    const cands = legalCandidates(obs);
    const p = candidateProbabilities(cands, uniformHeads());
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    const truth = cands[3].heads;
    const lu = jointLogLoss(cands, uniformHeads(), truth)!;
    const lo = jointLogLoss(cands, oneHotHeads(truth), truth)!;
    expect(lu).toBeCloseTo(Math.log(cands.length), 6);
    expect(lo).toBeLessThan(lu);
  });
  it('forecast scenarios: top-k legal candidates with weights summing to 1', () => {
    const { scenarios, legal, massCovered } = forecastScenarios(rich(60), uniformHeads(), 10);
    expect(scenarios.length).toBe(Math.min(10, legal));
    expect(scenarios.reduce((a, s) => a + (s.weight ?? 0), 0)).toBeCloseTo(1, 9);
    expect(massCovered).toBeGreaterThan(0);
    expect(HEAD_CLASSES.hands).toContain('ranged_melee');
  });
});

describe('head-model inference failure', () => {
  it('a missing model artifact is an error result, never a fabricated forecast', async () => {
    const { scoreHeads } = await import('../../src/ml/build-predictor.js');
    const r = await scoreHeads('artifacts/models/does-not-exist', {});
    expect(r.ok).toBe(false);
  });
});
