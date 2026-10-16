/**
 * Feature schema v2 + label v2 (V2_DEMANDS D-P0-4, D-PEN-3, D-PEN-4): intended-style label without the forced
 * opening shot, missing values as null (not 0), catalogue-agnostic feasibility features, weapon family/pierce EV.
 */
import { describe, expect, it } from 'vitest';
import { runFullCombat, type Chooser } from '../../src/game/combat.js';
import { snapshotOf } from '../../src/game/derive.js';
import { initialCombatant } from '../../src/game/progression.js';
import { summarizeCombat } from '../../src/game/summary.js';
import type { CombatantState, Loadout } from '../../src/game/types.js';
import { buildFeatures, FEATURE_NAMES, FEATURE_SCHEMA_VERSION, labelStyle, type RoundRecord } from '../../src/ml/features.js';

const meleeFirst: Chooser = (c) => ({ mode: c.options.includes('melee') ? 'melee' : c.options[0], source: 'agent' });

function round(loadout: Partial<Loadout>, post: Partial<CombatantState> = {}, opts: { dex?: number; bossBow?: boolean } = {}): RoundRecord {
  const lo = { hand1: null, hand2: null, armour: null, ...loadout };
  const p = { ...initialCombatant('player'), statPoints: 0, inventory: [lo.hand1, lo.hand2].filter(Boolean) as string[], loadout: lo, stats: { hp: 100, str: 20, def: 10, dex: opts.dex ?? 10 } };
  const b = { ...initialCombatant('boss'), statPoints: 0, inventory: opts.bossBow ? ['bow'] : [], loadout: { hand1: opts.bossBow ? 'bow' : null, hand2: null, armour: null } };
  const ps = snapshotOf(p);
  const bs = snapshotOf(b);
  const { state, events } = runFullCombat(ps, bs, 5, { player: meleeFirst, boss: meleeFirst });
  return {
    roundNumber: 1, winner: state.winner!, playerSnapshot: ps, bossSnapshot: bs,
    playerPost: { ...p, gold: 10, ...post }, playerHpEnd: state.hp.player, bossHpEnd: state.hp.boss, summary: summarizeCombat(events),
  };
}

describe('label v2: intended style', () => {
  it('a Bow + Sword hybrid that chose melee is labelled melee even though its opening shot was ranged', () => {
    const r = round({ hand1: 'bow', hand2: 'sword' }, {}, { dex: 30 });
    expect(r.summary.player.attacksByPhase.opening).toBe(1);
    expect(r.summary.player.rangedShare).toBeGreaterThan(0); // v1 counted the forced shot
    expect(labelStyle(r)).toMatchObject({ label: 0, from: 'attacks', nonOpeningRangedShare: 0 });
  });
  it('no choosable attacks: a single-style loadout decides; a hybrid is invalid', () => {
    const r = round({ hand1: 'bow' });
    r.summary.player.nonOpeningAttacks = 0;
    r.summary.player.nonOpeningRanged = 0;
    expect(labelStyle(r)).toMatchObject({ label: 1, from: 'loadout' });
    const h = round({ hand1: 'bow', hand2: 'sword' });
    h.summary.player.nonOpeningAttacks = 0;
    expect(labelStyle(h).label).toBeNull();
  });
});

describe('feature schema v3', () => {
  it('is v3 and every feature name is produced', () => {
    expect(FEATURE_SCHEMA_VERSION).toBe('v3');
    expect(Object.keys(buildFeatures([round({ hand1: 'pike' })])).sort()).toEqual([...FEATURE_NAMES].sort());
  });
  it('weapon family one-hot and pierce EV of the last weapon', () => {
    const f = buildFeatures([round({ hand1: 'pike' })]);
    expect(f).toMatchObject({ last_weapon_polearm: 1, last_weapon_blade: 0, last_weapon_bow: 0 });
    expect(f.last_weapon_pierce_ev).toBeCloseTo(0.6 * 0.9);
  });
  it('feasibility features are catalogue-agnostic (cheapest ranged = 15)', () => {
    expect(buildFeatures([round({}, { gold: 10 })])).toMatchObject({ p_ranged_feasible: 0, p_gold_minus_cheapest_ranged: -5 });
    expect(buildFeatures([round({}, { gold: 15 })]).p_ranged_feasible).toBe(1);
  });
  it('missing ≠ zero: no player attacks → shares are null', () => {
    const r = round({});
    r.summary.player.attacks = 0;
    r.summary.player.rangedShare = null;
    r.summary.player.nonOpeningAttacks = 0;
    const f = buildFeatures([r]);
    expect(f.last_ranged_share).toBeNull();
    expect(f.hist_mean_ranged_share).toBeNull();
    expect(f.hist_ranged_round_frac).toBe(0); // unarmed-only loadout ⇒ style known (melee)
  });

  it('persistence features: a melee player who could afford a bow and stayed melee', () => {
    const r1 = round({ hand1: 'sword' }, { gold: 20, inventory: ['sword'] });
    const r2 = { ...round({ hand1: 'sword' }, { gold: 30, inventory: ['sword'] }), roundNumber: 2 };
    const f = buildFeatures([r1, r2]);
    expect(f).toMatchObject({ hist_style_switches: 0, last_style_streak: 2, hist_feasible_rounds: 1, hist_feasible_melee_rounds: 1, hist_ranged_when_feasible: 0 });
  });
});
