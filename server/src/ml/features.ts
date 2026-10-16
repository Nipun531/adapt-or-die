/**
 * ML FEATURE CONSTRUCTION (schema v2, engine 2.0.0) + LABEL + transparent BASELINE.
 *
 * Task: after round N finishes, predict whether the player will fight MOSTLY RANGED in round N+1 (label 1) or
 * mostly melee/unarmed (label 0). Prediction point = start of round N+1, BEFORE the player's round-(N+1)
 * preparation is visible. Features may therefore only use rounds 1..N.
 *
 * `buildFeatures(history)` receives ONLY completed rounds 1..N; it never sees round N+1, which is the
 * leakage guarantee (tested in tests/integration/ml.test.ts). If you add/remove/rename a feature or change the
 * label, bump FEATURE_SCHEMA_VERSION, rebuild the dataset and retrain.
 *
 * Schema v2 vs v1 (V2_DEMANDS D-P0-4, D-PEN-3, D-PEN-4):
 *  - catalogue-agnostic: `p_can_afford_bow/crossbow` → `p_ranged_feasible`, `p_gold_minus_cheapest_ranged`;
 *  - what the player fought with: one-hot `last_weapon_*` family + `last_weapon_pierce_ev` (chance × DEF ignored);
 *  - missing ≠ zero: shares are null (→ NaN in training) when the player made no attacks / no style is known;
 *  - label = INTENDED style: share of ranged attacks among the player's non-opening attacks (the opening shot is
 *    forced and, since engine 2.0.0, depends on the boss's DEX); with none, a single-style loadout decides.
 * Schema v3 vs v2: PERSISTENCE features — how often the player switched style, how long the current style has
 * lasted, and what they did in rounds where a ranged weapon was within reach. They separate "a melee player who never
 * switches" from "one who switches when they can", which fixed-style history alone cannot (model s3 failed
 * leave-one-strategy-out for exactly that reason).
 */
import { catalogFor, cheapestCost, getItem, itemForHistory } from '../game/catalog.js';
import type { CombatSummary } from '../game/summary.js';
import type { CombatantState, FighterSnapshot, Item, Side } from '../game/types.js';

export const FEATURE_SCHEMA_VERSION = 'v3';
export const ML_TASK = 'predict_next_round_player_mostly_ranged';
/** Label threshold: player's ranged share of (non-opening) attacks in the label round. */
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
  'p_ranged_feasible', 'p_gold_minus_cheapest_ranged',
  'p_owns_ranged', 'p_owns_melee', 'p_owns_shield',
  'last_has_ranged', 'last_has_melee', 'last_has_shield', 'last_armour_def',
  'last_weapon_blade', 'last_weapon_blunt', 'last_weapon_polearm', 'last_weapon_bow', 'last_weapon_pierce_ev',
  'last_ranged_share', 'last_attacks',
  'hist_mean_ranged_share', 'hist_ranged_round_frac',
  'last_player_won', 'player_wins_total', 'player_loss_streak',
  'last_player_hp_end_frac', 'last_boss_hp_end_frac',
  'last_boss_dmg_ranged_share',
  'p_eff_dex_last', 'p_net_atk_last',
  'boss_eff_dex_last', 'boss_net_def_last', 'boss_net_atk_last', 'boss_has_ranged_last', 'boss_has_shield_last',
  'hist_style_switches', 'last_style_streak', 'hist_feasible_rounds', 'hist_feasible_melee_rounds', 'hist_ranged_when_feasible',
] as const;
export type FeatureName = (typeof FEATURE_NAMES)[number];
/** null = missing (no evidence), never silently 0. Exported as an empty CSV cell → NaN for XGBoost. */
export type FeatureVector = Record<FeatureName, number | null>;

const handItems = (s: FighterSnapshot, ev?: string | null): Item[] =>
  [s.loadout.hand1, s.loadout.hand2].filter((x): x is string => x !== null).map((id) => itemForHistory(id, ev));

/** V1 label (kept for reference/sim summaries): ranged share of ALL attacks, incl. the forced opening shot. */
export function isMostlyRanged(summary: CombatSummary): boolean | null {
  const share = summary.player.rangedShare;
  return share === null ? null : share >= RANGED_LABEL_THRESHOLD;
}

export interface LabelResult {
  label: 0 | 1 | null;
  from: 'attacks' | 'loadout' | null;
  nonOpeningRangedShare: number | null;
}

/**
 * Label v2 = the player's INTENDED style in the label round (V2_DEMANDS D-PEN-4):
 * ranged share of non-opening attacks ≥ 0.5; with no such attacks, a single-style loadout decides
 * (ranged-only → 1, melee/unarmed-only → 0); a Ranged+Melee player who never chose → null (invalid row).
 */
export function labelStyle(r: RoundRecord): LabelResult {
  const p = r.summary.player;
  if (p.nonOpeningAttacks > 0) {
    const share = p.nonOpeningRanged / p.nonOpeningAttacks;
    return { label: share >= RANGED_LABEL_THRESHOLD ? 1 : 0, from: 'attacks', nonOpeningRangedShare: share };
  }
  const modes = r.playerSnapshot.derived.attackModes;
  if (modes.length === 1) return { label: modes[0] === 'ranged' ? 1 : 0, from: 'loadout', nonOpeningRangedShare: null };
  return { label: null, from: null, nonOpeningRangedShare: null };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * Build features from completed rounds 1..N (must be sorted ascending). Requires N ≥ 1.
 * `engineVersion` = the run's engine (item ids resolve against that engine's catalogue; default = live rules).
 */
export function buildFeatures(history: RoundRecord[], engineVersion?: string | null): FeatureVector {
  if (history.length === 0) throw new Error('buildFeatures needs at least one completed round');
  const item = (id: string) => itemForHistory(id, engineVersion);
  const last = history[history.length - 1];
  const post = last.playerPost;
  const inv = post.inventory.map((id) => item(id).category);
  const lastHands = handItems(last.playerSnapshot, engineVersion);
  const lastCats = lastHands.map((i) => i.category);
  const lastWeapons = lastHands.filter((i) => i.category === 'melee' || i.category === 'ranged');
  const fam = (f: Item['family']) => (lastWeapons.some((i) => i.family === f) ? 1 : 0);
  const pierceEv = Math.max(0, ...lastWeapons.map((i) => (i.pierce ? i.pierce.chance * i.pierce.defIgnore : 0)));
  const cheapestRanged = cheapestCost('ranged', catalogFor(engineVersion));
  const feasible = rangedFeasibility(post, engineVersion).rangedFeasible;
  const shares = history.map((h) => h.summary.player.rangedShare).filter((x): x is number => x !== null);
  const styles = history.map(roundStyle).filter((x): x is 0 | 1 => x !== null);
  // Persistence (v3): style per round, and whether a ranged weapon was within reach at that round's start
  // (round 1: never — 0 gold; round k: the player's post-round state of round k−1).
  const seq = history.map(roundStyle);
  const knownSeq = seq.filter((x): x is 0 | 1 => x !== null);
  let switches = 0;
  for (let i = 1; i < knownSeq.length; i++) if (knownSeq[i] !== knownSeq[i - 1]) switches++;
  let streak = 0;
  for (let i = knownSeq.length - 1; i >= 0 && knownSeq[i] === knownSeq[knownSeq.length - 1]; i--) streak++;
  let feasibleRounds = 0;
  let feasibleMelee = 0;
  let feasibleRanged = 0;
  history.forEach((h, i) => {
    const couldRange = i > 0 && rangedFeasibility(history[i - 1].playerPost, engineVersion).rangedFeasible;
    if (!couldRange || seq[i] === null) return;
    feasibleRounds++;
    if (seq[i] === 0) feasibleMelee++;
    else feasibleRanged++;
  });
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
    p_ranged_feasible: feasible ? 1 : 0,
    p_gold_minus_cheapest_ranged: post.gold - cheapestRanged,
    p_owns_ranged: inv.includes('ranged') ? 1 : 0,
    p_owns_melee: inv.includes('melee') ? 1 : 0,
    p_owns_shield: inv.includes('shield') ? 1 : 0,
    last_has_ranged: lastCats.includes('ranged') ? 1 : 0,
    last_has_melee: lastCats.includes('melee') ? 1 : 0,
    last_has_shield: lastCats.includes('shield') ? 1 : 0,
    last_armour_def: armour ? item(armour).mods.def : 0,
    last_weapon_blade: fam('blade'),
    last_weapon_blunt: fam('blunt'),
    last_weapon_polearm: fam('polearm'),
    last_weapon_bow: fam('bow'),
    last_weapon_pierce_ev: pierceEv,
    last_ranged_share: last.summary.player.rangedShare,
    last_attacks: last.summary.player.attacks,
    hist_mean_ranged_share: mean(shares),
    hist_ranged_round_frac: mean(styles),
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
    boss_has_shield_last: handItems(b, engineVersion).some((i) => i.category === 'shield') ? 1 : 0,
    hist_style_switches: knownSeq.length ? switches : null,
    last_style_streak: knownSeq.length ? streak : null,
    hist_feasible_rounds: feasibleRounds,
    hist_feasible_melee_rounds: feasibleMelee,
    hist_ranged_when_feasible: feasibleRounds ? feasibleRanged / feasibleRounds : null,
  };
}

/**
 * RULE-LEVEL FEASIBILITY (engine 2.0.0, V2_DEMANDS D-P0-1): can the player field a ranged weapon next round?
 * Uses only what the boss legitimately knows at decision time — the player's post-round state (inventory, gold).
 * The player can only spend the gold they have, so their unseen preparation cannot change the answer.
 * If false, P(mostly ranged) is exactly 0 by the rules — not an estimate.
 */
export function rangedFeasibility(state: CombatantState, engineVersion?: string | null): { rangedFeasible: boolean; reason: string } {
  const lookup = (id: string) => (engineVersion ? itemForHistory(id, engineVersion) : getItem(id));
  const owned = state.inventory.find((id) => lookup(id)?.category === 'ranged');
  if (owned) return { rangedFeasible: true, reason: `owns ${lookup(owned)!.name}` };
  const cheapest = cheapestCost('ranged', catalogFor(engineVersion));
  if (state.gold >= cheapest) return { rangedFeasible: true, reason: `can afford a ranged weapon (${state.gold} gold ≥ ${cheapest})` };
  return { rangedFeasible: false, reason: `owns no ranged weapon and cannot afford one (${state.gold} gold < ${cheapest})` };
}

/**
 * Style of the player in a completed round: 1 = mostly ranged, 0 = mostly melee/unarmed, null = unknown.
 * With no player attacks (killed before acting) the loadout decides when it allows only one style;
 * a Ranged+Melee player who never attacked is unknown (V2_DEMANDS D-P0-4: missing ≠ zero).
 */
export function roundStyle(h: RoundRecord): 0 | 1 | null {
  const share = h.summary.player.rangedShare;
  if (share !== null) return share >= RANGED_LABEL_THRESHOLD ? 1 : 0;
  const modes = h.playerSnapshot.derived.attackModes;
  if (modes.length === 1) return modes[0] === 'ranged' ? 1 : 0;
  return null;
}

/**
 * Transparent BASELINE / FALLBACK predictor:
 *   p = 0.5 × [last known round mostly ranged] + 0.5 × (ranged rounds + 1) / (known rounds + 2)
 * i.e. half "the player repeats what they just did", half a Laplace-smoothed historical frequency, over rounds whose
 * style is known (roundStyle). Returns 0 when the player cannot field a ranged weapon next round (rule), and null
 * when no style has been observed yet (no evidence — never a fake 0.5).
 */
export function baselineProbability(history: RoundRecord[]): number | null {
  if (history.length === 0) return null;
  if (!rangedFeasibility(history[history.length - 1].playerPost).rangedFeasible) return 0;
  const flags = history.map(roundStyle).filter((x): x is 0 | 1 => x !== null);
  if (flags.length === 0) return null; // history exists but no style was ever observed → still no evidence
  const k = flags.reduce((a: number, c) => a + c, 0);
  const laplace = (k + 1) / (flags.length + 2);
  return 0.5 * flags[flags.length - 1] + 0.5 * laplace;
}
