/**
 * Game-plan constants. EVERY number here comes from the "Game Mechanics — Current V1 Specification"
 * section of the game plan, or from an explicitly approved developer decision (marked DECISION).
 * Change balance here; tests in tests/unit/rules.test.ts pin these values to the plan.
 */
import type { Stats } from './types.js';

/** Engine version — stored on every run/round so historical data can be tied to the rules that produced it. */
export const ENGINE_VERSION = '3.1.0';
/** Engine version history (rules that change data meaning):
 *  1.0.0 — original V1 rules; combatants start with 0 stat points.
 *  1.1.0 — DEVELOPER RULE (user-approved): each combatant starts a run with INITIAL_STAT_POINTS unallocated points.
 *  2.0.0 — Version 2 (docs/V2_DEMANDS.md): V2 catalogue (catalogs/v2.ts), loss reward 30 XP / 5 gold, level-up +20 gold,
 *          pierce on any weapon that has a pierce spec, only the DEX-advantaged ranged fighter gets the opening shot.
 *  3.0.0 — Version 3 (docs/V3_DEMANDS.md): RuleSet v3 combat (block/dodge, counters, stun, stims, turn limit),
 *          V3 catalogue (catalogs/v3.ts), 10 starting gold, healing-stim economy.
 *  3.1.0 — Phase D2 (owner-approved hybrid fix): ranged weapon DEX counts 50% toward agility; dedicated archers ×1.3. */

/** Plan §1: starting values. */
export const BASE_STATS: Stats = { hp: 100, str: 20, def: 10, dex: 10 };

/** Plan §1: automatic increase applied on every level-up. */
export const LEVEL_UP_INCREASE: Stats = { hp: 5, str: 2, def: 1, dex: 1 };

/** Plan §1: increase per stat point allocated. */
export const STAT_ALLOCATION_INCREASE: Stats = { hp: 5, str: 3, def: 2, dex: 2 };

/** DECISION (developer, not in plan): 1 stat point per level-up. Skill points are not used in V1. */
export const STAT_POINTS_PER_LEVEL = 1;

/**
 * DECISION (user-requested, engine 1.1.0): both combatants receive 2 unallocated stat points when a run is created.
 * They are spent with the normal allocation rule (HP+5 / STR+3 / DEF+2 / DEX+2 per point) before round 1:
 * the player must allocate them before starting round 1; the boss allocates them in its round-1 preparation.
 * Granted exactly once, at run creation — never on resume or in later rounds.
 */
export const INITIAL_STAT_POINTS = 2;

/** Plan §2: XP requirement to reach level L = 100 × 1.12^(L − 2). */
export const XP_BASE = 100;
export const XP_MULTIPLIER = 1.12;

/** Round rewards. V2 (engine 2.0.0, user-specified): win 50 XP / 10 gold, loss 30 XP / 5 gold. (V1: loss 20 XP / 4 gold.) */
export const XP_WIN = 50;
export const XP_LOSS = 30;
export const GOLD_WIN = 10;
export const GOLD_LOSS = 5;
/** Gold awarded on each level-up. V2: 20 (V1: 25). */
export const GOLD_LEVEL_UP = 20;

/** Both combatants start with no equipment. V3 (owner, 2026-10-19): 10 starting gold (V1/V2: 0). */
export const STARTING_GOLD = 10;

/**
 * Healing-stim economy (V3; docs/V3_DEMANDS.md §6). Owner: 10 gold buys one stim; 1 slot to start; a used stim's slot
 * stays empty until a new stim is bought. DEFAULT (owner delegated): each upgrade costs 25, +5 per upgrade of that
 * kind already bought; a slot upgrade adds 1 slot (max 4); an effectiveness upgrade adds +5 pp heal (max 4 → 40%).
 */
export const STIM_COST = 10;
export const STIM_UPGRADE_BASE_COST = 25;
export const STIM_UPGRADE_STEP = 5;
export const STIM_BASE_SLOTS = 1;
export const STIM_MAX_SLOTS = 4;
export const STIM_MAX_EFFECTIVENESS = 4;

/** Plan §3: modifier factors in Net ATK / Net DEF / Net DEX formulas. */
export const ATK_MOD_FACTOR = 0.25;
export const DEF_MOD_FACTOR = 0.5;
export const DEX_MOD_FACTOR = 0.25;

/** Plan §3: DEX mitigation random roll range. */
export const MITIGATION_ROLL_MIN = 0.2;
export const MITIGATION_ROLL_MAX = 0.5;

/** Plan §4: DEX advantage thresholds for bonus attacks (checked highest first). */
export const DEX_BONUS_THRESHOLDS: { advantage: number; attacks: number }[] = [
  { advantage: 30, attacks: 2 },
  { advantage: 15, attacks: 1 },
];

/**
 * DECISION: effective DEX is floored at 1. Heavy DEX penalties can push Net DEX to 0 or below,
 * which would make the DEX ratio undefined (division by zero) and ranged attack values non-positive.
 */
export const EFFECTIVE_DEX_FLOOR = 1;

/**
 * Technical safety guard (not a game rule): a round aborts with an error if it exceeds this many attacks.
 * Damage is always > 0, so real rounds terminate long before this.
 */
export const MAX_ATTACKS_PER_ROUND = 10_000;

/** DECISION: default maximum rounds per run (the player may end a run earlier). */
export const DEFAULT_MAX_ROUNDS = 10;
