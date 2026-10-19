/**
 * Progression: initial state, round rewards, XP and automatic level-ups.
 * Same rules for player and boss. Returns the new state plus a ledger of what happened,
 * which the round service persists as progression_events.
 */
import {
  BASE_STATS,
  INITIAL_STAT_POINTS,
  GOLD_LEVEL_UP,
  GOLD_LOSS,
  GOLD_WIN,
  LEVEL_UP_INCREASE,
  STARTING_GOLD,
  STIM_BASE_SLOTS,
  STAT_POINTS_PER_LEVEL,
  XP_LOSS,
  XP_WIN,
} from './constants.js';
import { xpToNextLevel } from './formulas.js';
import type { CombatantState, Side, Stats } from './types.js';

export function initialCombatant(side: Side): CombatantState {
  return {
    side,
    level: 1,
    xp: 0,
    gold: STARTING_GOLD,
    statPoints: INITIAL_STAT_POINTS, // spent before round 1 (see constants.ts)
    stats: { ...BASE_STATS },
    inventory: [],
    loadout: { hand1: null, hand2: null, armour: null },
    supplies: { stims: 0, slots: STIM_BASE_SLOTS, effectiveness: 0 },
  };
}

export type ProgressionEntry =
  | { kind: 'xp'; amount: number; reason: 'win' | 'loss' }
  | { kind: 'gold'; amount: number; reason: 'win' | 'loss' | 'level_up' }
  | { kind: 'level_up'; fromLevel: number; toLevel: number; xpSpent: number; statIncrease: Stats; statPointsGained: number };

export interface RewardResult {
  state: CombatantState;
  entries: ProgressionEntry[];
  levelUps: number;
}

/**
 * Apply end-of-round rewards (constants.ts; V2: winner 50 XP / 10 gold, loser 30 XP / 5 gold).
 * Then resolve level-ups: while XP >= requirement → spend requirement, +1 level, automatic stat increase,
 * +STAT_POINTS_PER_LEVEL stat points, +GOLD_LEVEL_UP gold (V2: 20). Surplus XP carries over.
 */
export function applyRoundRewards(state: CombatantState, won: boolean): RewardResult {
  const reason = won ? 'win' : 'loss';
  const xpGain = won ? XP_WIN : XP_LOSS;
  const goldGain = won ? GOLD_WIN : GOLD_LOSS;
  const entries: ProgressionEntry[] = [
    { kind: 'xp', amount: xpGain, reason },
    { kind: 'gold', amount: goldGain, reason },
  ];
  let next: CombatantState = { ...state, stats: { ...state.stats }, xp: state.xp + xpGain, gold: state.gold + goldGain };
  let levelUps = 0;
  while (next.xp >= xpToNextLevel(next.level)) {
    const req = xpToNextLevel(next.level);
    const stats: Stats = {
      hp: next.stats.hp + LEVEL_UP_INCREASE.hp,
      str: next.stats.str + LEVEL_UP_INCREASE.str,
      def: next.stats.def + LEVEL_UP_INCREASE.def,
      dex: next.stats.dex + LEVEL_UP_INCREASE.dex,
    };
    entries.push({
      kind: 'level_up',
      fromLevel: next.level,
      toLevel: next.level + 1,
      xpSpent: req,
      statIncrease: { ...LEVEL_UP_INCREASE },
      statPointsGained: STAT_POINTS_PER_LEVEL,
    });
    entries.push({ kind: 'gold', amount: GOLD_LEVEL_UP, reason: 'level_up' });
    next = {
      ...next,
      xp: next.xp - req,
      level: next.level + 1,
      stats,
      statPoints: next.statPoints + STAT_POINTS_PER_LEVEL,
      gold: next.gold + GOLD_LEVEL_UP,
    };
    levelUps++;
  }
  return { state: next, entries, levelUps };
}
