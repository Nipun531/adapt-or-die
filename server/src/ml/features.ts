/**
 * ML FEATURE CONSTRUCTION (schema v1) + transparent BASELINE.
 *
 * Task: after round N finishes, predict whether the player's attacks in round N+1 will be MOSTLY RANGED
 * (label 1) or mostly melee/unarmed (label 0). Prediction point = start of round N+1, BEFORE the player's
 * round-(N+1) preparation is visible. Features may therefore only use rounds 1..N.
 *
 * `buildFeatures(history)` receives ONLY completed rounds 1..N; it never sees round N+1, which is the
 * leakage guarantee (tested in tests/integration/ml.test.ts). If you add/remove/rename a feature,
 * bump FEATURE_SCHEMA_VERSION, rebuild the dataset and retrain.
 */
import { itemForHistory } from '../game/catalog.js';
import type { CombatSummary } from '../game/summary.js';
import type { CombatantState, FighterSnapshot, Side } from '../game/types.js';

export const FEATURE_SCHEMA_VERSION = 'v1';
export const ML_TASK = 'predict_next_round_player_mostly_ranged';
/** Label threshold: player's ranged share of attacks in the label round. */
export const RANGED_LABEL_THRESHOLD = 0.5;

/** Everything the feature builder may know about one COMPLETED round. */
export interface RoundRecord {
  roundNumber: number;
  winner: Side;
  playerSnapshot: FighterSnapshot;
  bossSnapshot: FighterSnapshot;
  playerPost: CombatantState; // after rewards/level-ups of that round
  playerHpEnd: number;
  bossHpEnd: number;
  summary: CombatSummary;
}

export const FEATURE_NAMES = [
  'next_round_number',
  'p_level', 'p_hp', 'p_str', 'p_def', 'p_dex', 'p_stat_points', 'p_gold',
  'p_can_afford_bow', 'p_can_afford_crossbow',
  'p_owns_ranged', 'p_owns_melee', 'p_owns_shield',
  'last_has_ranged', 'last_has_melee', 'last_has_shield', 'last_armour_def',
  'last_ranged_share', 'last_attacks',
  'hist_mean_ranged_share', 'hist_ranged_round_frac',
  'last_player_won', 'player_wins_total', 'player_loss_streak',
  'last_player_hp_end_frac', 'last_boss_hp_end_frac',
  'last_boss_dmg_ranged_share',
  'p_eff_dex_last', 'p_net_atk_last',
  'boss_eff_dex_last', 'boss_net_def_last', 'boss_net_atk_last', 'boss_has_ranged_last', 'boss_has_shield_last',
] as const;
export type FeatureName = (typeof FEATURE_NAMES)[number];
export type FeatureVector = Record<FeatureName, number>;

const cats = (s: FighterSnapshot, ev?: string | null) =>
  [s.loadout.hand1, s.loadout.hand2].filter((x): x is string => x !== null).map((id) => itemForHistory(id, ev).category);

export function isMostlyRanged(summary: CombatSummary): boolean | null {
  const share = summary.player.rangedShare;
  return share === null ? null : share >= RANGED_LABEL_THRESHOLD;
}

/**
 * Build features from completed rounds 1..N (must be sorted ascending). Requires N ≥ 1.
 * `engineVersion` = the run's engine (item ids resolve against that engine's catalogue; default = live rules).
 */
export function buildFeatures(history: RoundRecord[], engineVersion?: string | null): FeatureVector {
  const item = (id: string) => itemForHistory(id, engineVersion);
  if (history.length === 0) throw new Error('buildFeatures needs at least one completed round');
  const last = history[history.length - 1];
  const post = last.playerPost;
  const inv = post.inventory.map((id) => item(id).category);
  const lastCats = cats(last.playerSnapshot, engineVersion);
  const shares = history.map((h) => h.summary.player.rangedShare ?? 0);
  const wins = history.filter((h) => h.winner === 'player').length;
  let lossStreak = 0;
  for (let i = history.length - 1; i >= 0 && history[i].winner === 'boss'; i--) lossStreak++;
  const bossDmg = last.summary.boss.damageDealt;
  const armour = last.playerSnapshot.loadout.armour;
  const b = last.bossSnapshot;

  return {
    next_round_number: last.roundNumber + 1,
    p_level: post.level,
    p_hp: post.stats.hp,
    p_str: post.stats.str,
    p_def: post.stats.def,
    p_dex: post.stats.dex,
    p_stat_points: post.statPoints,
    p_gold: post.gold,
    p_can_afford_bow: post.gold >= item('bow').cost ? 1 : 0,
    p_can_afford_crossbow: post.gold >= item('crossbow').cost ? 1 : 0,
    p_owns_ranged: inv.includes('ranged') ? 1 : 0,
    p_owns_melee: inv.includes('melee') ? 1 : 0,
    p_owns_shield: inv.includes('shield') ? 1 : 0,
    last_has_ranged: lastCats.includes('ranged') ? 1 : 0,
    last_has_melee: lastCats.includes('melee') ? 1 : 0,
    last_has_shield: lastCats.includes('shield') ? 1 : 0,
    last_armour_def: armour ? item(armour).mods.def : 0,
    last_ranged_share: last.summary.player.rangedShare ?? 0,
    last_attacks: last.summary.player.attacks,
    hist_mean_ranged_share: shares.reduce((a, c) => a + c, 0) / shares.length,
    hist_ranged_round_frac: shares.filter((s) => s >= RANGED_LABEL_THRESHOLD).length / shares.length,
    last_player_won: last.winner === 'player' ? 1 : 0,
    player_wins_total: wins,
    player_loss_streak: lossStreak,
    last_player_hp_end_frac: Math.max(0, last.playerHpEnd) / last.playerSnapshot.derived.maxHp,
    last_boss_hp_end_frac: Math.max(0, last.bossHpEnd) / b.derived.maxHp,
    last_boss_dmg_ranged_share: bossDmg > 0 ? last.summary.boss.damageByMode.ranged / bossDmg : 0,
    p_eff_dex_last: last.playerSnapshot.derived.effDex,
    p_net_atk_last: last.playerSnapshot.derived.netAtk,
    boss_eff_dex_last: b.derived.effDex,
    boss_net_def_last: b.derived.netDef,
    boss_net_atk_last: b.derived.netAtk,
    boss_has_ranged_last: b.derived.rangedWeaponId ? 1 : 0,
    boss_has_shield_last: cats(b, engineVersion).includes('shield') ? 1 : 0,
  };
}

/**
 * Transparent BASELINE / FALLBACK predictor:
 *   p = 0.5 × [last round mostly ranged] + 0.5 × (ranged rounds + 1) / (rounds + 2)
 * i.e. half "the player repeats what they just did", half a Laplace-smoothed historical frequency.
 * With no history it returns 0.5 (no information).
 */
export function baselineProbability(history: RoundRecord[]): number {
  if (history.length === 0) return 0.5;
  const flags = history.map((h) => ((h.summary.player.rangedShare ?? 0) >= RANGED_LABEL_THRESHOLD ? 1 : 0));
  const k = flags.reduce((a: number, c) => a + c, 0);
  const laplace = (k + 1) / (history.length + 2);
  return 0.5 * flags[flags.length - 1] + 0.5 * laplace;
}
