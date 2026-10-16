/**
 * Game-plan constants. EVERY number here comes from the "Game Mechanics — Current V1 Specification"
 * section of the game plan, or from an explicitly approved developer decision (marked DECISION).
 * Change balance here; tests in tests/unit/rules.test.ts pin these values to the plan.
 */
import type { Stats } from './types.js';

/** Engine version — stored on every run/round so historical data can be tied to the rules that produced it. */
export const ENGINE_VERSION = '1.1.0';
/** Engine version history (rules that change data meaning):
 *  1.0.0 — original V1 rules; combatants start with 0 stat points.
 *  1.1.0 — DEVELOPER RULE (user-approved): each combatant starts a run with INITIAL_STAT_POINTS unallocated points. */

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

/** Plan §2: round rewards. */
export const XP_WIN = 50;
export const XP_LOSS = 20;
export const GOLD_WIN = 10;
export const GOLD_LOSS = 4;
/** Plan §2: gold awarded on each level-up. */
export const GOLD_LEVEL_UP = 25;

/** DECISION: both combatants start with 0 gold and no equipment. */
export const STARTING_GOLD = 0;

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
