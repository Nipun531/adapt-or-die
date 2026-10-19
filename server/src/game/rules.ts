/**
 * RULE SETS — which combat rules a fight uses (docs/V3_IMPLEMENTATION_PLAN.md §F.1).
 *
 *   v2 — engine 2.0.0 exactly (every attack hits; the V2 control for paired comparisons).
 *   v3 — V3 combat (docs/V3_DEMANDS.md): the defender blocks or dodges every attack, counters, stun meters, stims.
 *
 * Every V3 number lives here, in one frozen object. Values are the owner's decisions or Claude's documented defaults
 * (marked DEFAULT in V3_DEMANDS.md); `provisional` ones are tuned by simulation only with owner approval.
 * `dexBenefits` lets the balance harness switch individual DEX advantages off (plan D-8 ablation). Both
 * shipped rule sets keep all of them on.
 */
import { requireItem, requireItemV3 } from './catalog.js';
import type { Item } from './types.js';

export type RuleSetId = 'v2' | 'v3';

export interface DexBenefits {
  /** DEX mitigation on incoming damage (V1 plan §3). */
  mitigation: boolean;
  /** Bonus attacks at a DEX advantage of 15 / 30. */
  bonusAttacks: boolean;
  /** Higher effective DEX acts first each turn (off → initiative coin flip decides). */
  turnOrder: boolean;
  /** Ranged First Shot before turn 1. */
  firstShot: boolean;
}

export interface V3Combat {
  /** Dodge chance = min(cap, perDexPoint × max(0, defender effDex − attacker effDex)). Owner: 2% per point, cap 70%. */
  dodge: { perDexPoint: number; cap: number };
  /**
   * Block chance = min(cap, defFactor × D + Σ equipped blockBonus). D = the DEF stat ('raw') or Net DEF ('net').
   * Owner: 0.5 × DEF (as %), cap 70%, simulate both D readings (default 'raw').
   */
  block: { defFactor: number; defSource: 'raw' | 'net'; cap: number };
  counter: {
    /** Counter damage multipliers on the counterer's own mini-move damage (owner D-1). */
    blockMultiplier: number;
    dodgeMultiplier: number;
    /** Block counter chance = min(cap, attack shaved off). DEFAULT cap. */
    blockChanceCap: number;
    /** Dodge counter chance = min(cap, dodge delta % + weapon dodge-counter mod). DEFAULT cap. */
    dodgeChanceCap: number;
    /** Stun added to the countered attacker by a block counter. Doc: 20. Dodge counters add none. */
    blockCounterStun: number;
  };
  stun: {
    threshold: number;
    /** Gain per landed hit = base + span × min(1, shaved + mitigation roll + weapon stun boost) (owner Q-2). */
    base: number;
    span: number;
    /** A blocked hit adds stun to the blocker when its would-be damage ≥ this share of the blocker's max HP. DEFAULT, provisional. */
    heavyBlockFraction: number;
    /** Extra damage on a successful stun = this share of the stunning hit's damage. DEFAULT, provisional. */
    extraDamageFraction: number;
  };
  stim: {
    /** Heal = (base + perUpgrade × effectiveness upgrades) × max HP, never above max HP. Owner: 20%. */
    healBase: number;
    healPerUpgrade: number;
  };
}

/** Plain data (JSON-serialisable): a paused CombatState stores its RuleSet, harness variants included. */
export interface RuleSet {
  id: RuleSetId;
  dexBenefits: DexBenefits;
  /** null for v2. */
  v3: V3Combat | null;
}

const ALL_DEX: DexBenefits = { mitigation: true, bonusAttacks: true, turnOrder: true, firstShot: true };

export const RULES_V2: RuleSet = Object.freeze({ id: 'v2', dexBenefits: ALL_DEX, v3: null });

export const V3_COMBAT: V3Combat = Object.freeze({
  dodge: { perDexPoint: 0.02, cap: 0.7 },
  block: { defFactor: 0.005, defSource: 'raw', cap: 0.7 },
  counter: { blockMultiplier: 1.5, dodgeMultiplier: 0.75, blockChanceCap: 0.7, dodgeChanceCap: 0.7, blockCounterStun: 20 },
  stun: { threshold: 100, base: 10, span: 10, heavyBlockFraction: 0.25, extraDamageFraction: 0.25 },
  stim: { healBase: 0.2, healPerUpgrade: 0.05 },
}) as V3Combat;

export const RULES_V3: RuleSet = Object.freeze({ id: 'v3', dexBenefits: ALL_DEX, v3: V3_COMBAT });

/** Item table a rule set reads: v3 items carry block/stun/counter properties. */
export function itemLookup(rules: Pick<RuleSet, 'id'>): (id: string) => Item {
  return rules.id === 'v3' ? requireItemV3 : requireItem;
}

export function rulesFor(id: RuleSetId | undefined): RuleSet {
  return id === 'v3' ? RULES_V3 : RULES_V2;
}

/** Harness-only variants (ablations / sweeps). Not used by live play. */
export function withRules(base: RuleSet, patch: { dexBenefits?: Partial<DexBenefits>; v3?: Partial<{ [K in keyof V3Combat]: Partial<V3Combat[K]> }> }): RuleSet {
  const v3 = base.v3
    ? (Object.fromEntries(Object.entries(base.v3).map(([k, v]) => [k, { ...v, ...((patch.v3 as Record<string, object> | undefined)?.[k] ?? {}) }])) as unknown as V3Combat)
    : null;
  return { ...base, dexBenefits: { ...base.dexBenefits, ...patch.dexBenefits }, v3 };
}
