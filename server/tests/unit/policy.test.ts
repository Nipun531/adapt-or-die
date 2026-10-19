/**
 * Boss policy v2 + prediction semantics (V2_DEMANDS §5, §6): rule-level feasibility, honest "no evidence",
 * reachable-opponent scenarios, legality, the diversity band invariant and reproducibility. Pure — no database.
 */
import { describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/pool.js';
import { snapshotOf } from '../../src/game/derive.js';
import { requireItem } from '../../src/game/catalog.js';
import { initialCombatant } from '../../src/game/progression.js';
import { Rng } from '../../src/game/rng.js';
import { summarizeCombat } from '../../src/game/summary.js';
import type { CombatantState } from '../../src/game/types.js';
import { allocationOptions, applyPlan, archetypeOf, choosePlan, POLICY_CONFIG, reachableScenarios } from '../../src/boss/policy.js';
import { baselineProbability, rangedFeasibility, roundStyle, type RoundRecord } from '../../src/ml/features.js';
import { predictPlayerStyle } from '../../src/ml/predictor.js';

const player = (o: Partial<CombatantState> = {}): CombatantState => ({ ...initialCombatant('player'), statPoints: 0, ...o });
const noDb = null as unknown as Db; // the paths under test return before any query

describe('ranged feasibility (rule-level, decision-time information)', () => {
  it('round 1: 0 gold, no items → impossible', () => expect(rangedFeasibility(initialCombatant('player')).rangedFeasible).toBe(false));
  it('gold below the cheapest bow (15) → impossible; exactly 15 → possible', () => {
    expect(rangedFeasibility(player({ gold: 14 })).rangedFeasible).toBe(false);
    expect(rangedFeasibility(player({ gold: 15 })).rangedFeasible).toBe(true);
  });
  it('owning a bow → possible, whatever the gold', () => expect(rangedFeasibility(player({ inventory: ['bow'] })).rangedFeasible).toBe(true));
});

describe('prediction basis (no fake 50%)', () => {
  it('infeasible → basis rule, P = 0, no model asked', async () => {
    const p = await predictPlayerStyle(noDb, null, null, rangedFeasibility(initialCombatant('player')));
    expect(p).toMatchObject({ basis: 'rule', kind: 'fallback', probabilityRanged: 0 });
    expect(p.fallbackReason).toMatch(/cannot afford/);
  });
  it('feasible with no history → basis unknown, P = null', async () => {
    const p = await predictPlayerStyle(noDb, null, null, rangedFeasibility(player({ gold: 20 })));
    expect(p).toMatchObject({ basis: 'unknown', probabilityRanged: null });
  });
});

/** Minimal completed-round record for baseline tests. */
function record(rangedShare: number | null, loadout = { hand1: null, hand2: null, armour: null } as CombatantState['loadout'], post = player({ gold: 30 })): RoundRecord {
  const snap = snapshotOf({ ...post, inventory: [loadout.hand1, loadout.hand2].filter(Boolean) as string[], loadout });
  const summary = summarizeCombat([]);
  summary.player.rangedShare = rangedShare;
  return { roundNumber: 1, winner: 'boss', playerSnapshot: snap, bossSnapshot: snapshotOf(initialCombatant('boss')), playerPost: post, playerHpEnd: 0, bossHpEnd: 50, summary };
}

describe('baseline semantics', () => {
  it('no history → null (no evidence), never 0.5', () => expect(baselineProbability([])).toBeNull());
  it('player cannot field a ranged weapon next round → 0', () => expect(baselineProbability([record(1, undefined, player({ gold: 3 }))])).toBe(0));
  it('a round with no attacks is not "0% ranged": the loadout decides when it allows one style', () => {
    expect(roundStyle(record(null, { hand1: 'bow', hand2: null, armour: null }))).toBe(1);
    expect(roundStyle(record(null, { hand1: 'sword', hand2: null, armour: null }))).toBe(0);
    expect(roundStyle(record(null, { hand1: 'bow', hand2: 'sword', armour: null }))).toBeNull();
  });
  it('only rounds of unknown style → null', () => expect(baselineProbability([record(null, { hand1: 'bow', hand2: 'sword', armour: null })])).toBeNull());
  it('repeat + Laplace over known rounds', () => expect(baselineProbability([record(1), record(1)])).toBeCloseTo(0.5 + 0.5 * 3 / 4));
});

describe('reachable-opponent scenarios', () => {
  it('round 1 (10 starting gold): only melee, the 4 ways to spend the 2 initial points × the affordable melee weapons', () => {
    const s = reachableScenarios(initialCombatant('player'), 0);
    expect(s.every((x) => x.kind === 'melee')).toBe(true); // no bow is affordable with 10 gold
    expect(new Set(s.map((x) => JSON.stringify(x.allocation)))).toEqual(new Set([{ str: 2 }, { dex: 2 }, { def: 2 }, { hp: 2 }].map((a) => JSON.stringify(a))));
    expect(s.every((x) => x.hypotheticalItems.every((id) => requireItem(id).cost <= 10))).toBe(true);
    expect(s.reduce((a, x) => a + x.weight!, 0)).toBeCloseTo(1);
    expect(s.find((x) => x.allocation?.dex)!.snapshot.stats.dex).toBe(14);
  });
  it('no hypothetical bow the player cannot afford (the old round-1 bug)', () => {
    expect(reachableScenarios(player({ gold: 10 }), 0.5).some((x) => x.kind === 'ranged')).toBe(false);
  });
  it('affordable/owned weapons per family; P(ranged) split over ranged scenarios', () => {
    const s = reachableScenarios(player({ gold: 30, statPoints: 1 }), 0.4);
    const ranged = s.filter((x) => x.kind === 'ranged');
    expect(ranged.length).toBe(2); // dex / hp
    expect(ranged.every((x) => x.snapshot.loadout.hand1 === 'crossbow')).toBe(true); // most expensive affordable bow (28)
    expect(ranged.reduce((a, x) => a + x.weight!, 0)).toBeCloseTo(0.4);
    const meleeWeapons = new Set(s.filter((x) => x.kind === 'melee').map((x) => x.snapshot.loadout.hand1));
    expect(meleeWeapons).toEqual(new Set(['flail', 'lance', 'longsword'])); // strongest affordable blunt / polearm / blade
  });
  it('no evidence (null) → styles weighted equally', () => {
    const s = reachableScenarios(player({ inventory: ['bow'] }), null);
    expect(s.filter((x) => x.kind === 'ranged').reduce((a, x) => a + x.weight!, 0)).toBeCloseTo(0.5);
  });
  it('P = 0 drops ranged scenarios entirely', () => {
    expect(reachableScenarios(player({ inventory: ['bow'] }), 0).some((x) => x.kind === 'ranged')).toBe(false);
  });
});

describe('choosePlan v2', () => {
  const states = () => {
    const rng = new Rng(99);
    return Array.from({ length: 6 }, (_, i) => ({
      boss: { ...initialCombatant('boss'), level: 2 + (i % 3), statPoints: i % 3, gold: Math.floor(rng.next() * 80), inventory: i % 2 ? ['sword'] : [] },
      observed: player({ gold: Math.floor(rng.next() * 60), statPoints: i % 2, inventory: i % 3 === 0 ? ['bow'] : ['mace'], loadout: { hand1: i % 3 === 0 ? 'bow' : 'mace', hand2: null, armour: null } }),
    }));
  };
  it('every selected plan is legal, spends every point and keeps gold ≥ 0; the pick stays inside the band', () => {
    for (const [i, st] of states().entries()) {
      const r = choosePlan({ boss: st.boss, observedPlayer: st.observed, pRanged: 0.5, seed: `t${i}` });
      const after = applyPlan(st.boss, r.selected);
      expect(after.statPoints).toBe(0);
      expect(after.gold).toBeGreaterThanOrEqual(0);
      const best = Math.max(...[r.selected, ...r.alternatives].map((p) => p.weighted));
      expect(r.selected.weighted).toBeGreaterThanOrEqual(best - POLICY_CONFIG.band - 1e-9);
      expect(r.band!.reduce((a, b) => a + b.probability, 0)).toBeCloseTo(1);
    }
  });
  it('is reproducible for the same seed and inputs', () => {
    const st = states()[1];
    const a = choosePlan({ boss: st.boss, observedPlayer: st.observed, pRanged: 0.3, seed: 'same' });
    const b = choosePlan({ boss: st.boss, observedPlayer: st.observed, pRanged: 0.3, seed: 'same' });
    expect(b.selected).toEqual(a.selected);
    expect(b.draw).toBe(a.draw);
  });
  it('round 1 (rule: melee only) considers the player spending their 2 points', () => {
    const r = choosePlan({ boss: initialCombatant('boss'), observedPlayer: initialCombatant('player'), pRanged: 0, seed: 'r1' });
    expect(new Set(r.scenarios.map((s) => JSON.stringify(s.allocation))).size).toBe(4);
    expect(r.scenarios.every((s) => s.kind === 'melee')).toBe(true);
    const after = applyPlan(initialCombatant('boss'), r.selected);
    expect(after.statPoints).toBe(0);
    expect(after.gold).toBeGreaterThanOrEqual(0);
  });
  it('v1 path still works (rollback)', () => {
    const r = choosePlan({ boss: initialCombatant('boss'), observedPlayer: initialCombatant('player'), pRanged: 0.5, seed: 'v1', version: 'v1-deterministic' });
    expect(r.version).toBe('v1-deterministic');
    expect(r.scenarios.length).toBe(2);
  });
});

describe('helpers', () => {
  it('allocation enumeration: every split up to 6 points (84 for 6), dumps + pairs beyond', () => {
    expect(allocationOptions(2).length).toBe(10);
    expect(allocationOptions(6).length).toBe(84);
    expect(allocationOptions(7).length).toBe(4 + 6);
  });
  it('archetypes', () => {
    const plan = (hand1: string | null, hand2: string | null, alloc = {}) => ({ allocation: alloc, purchases: [], loadout: { hand1, hand2, armour: null }, cost: 0 });
    expect(archetypeOf(plan('bow', 'sword'))).toBe('hybrid');
    expect(archetypeOf(plan('longbow', null))).toBe('marksman');
    expect(archetypeOf(plan('pike', null))).toBe('piercer');
    expect(archetypeOf(plan(null, null, { str: 2 }))).toBe('bruiser');
    expect(archetypeOf(plan('sword', null, { dex: 1 }))).toBe('duelist');
    expect(archetypeOf(plan('sword', 'great_shield'))).toBe('bulwark');
  });
});
