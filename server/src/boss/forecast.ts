/**
 * NEXT-BUILD FORECASTS (V4, docs/V4_IMPLEMENTATION_PLAN.md §4).
 *
 * A forecast is one probability distribution per head (boss/build-heads.ts). A legal candidate's probability is the
 * product of its head probabilities, renormalised over the legal candidates (boss/candidates.ts), so the planner
 * only ever weighs builds the player can really bring. The planner simulates the most likely candidates and scores
 * each boss plan by the expected HP margin over them (policy.ts, unchanged objective), so uncertainty is priced in:
 * a plan that only beats the single likeliest build loses expected value against the others.
 *
 * Forecasters:
 *   uniform      rules only: every legal candidate equally likely (Learning Boss cold start; the ablation)
 *   persistence  the transparent baseline, per head: 0.5·[same as last round] + 0.5·Laplace frequency over the
 *                rounds seen (the old P(ranged) baseline generalised to every head; history of THIS run only)
 *   profile      Learning Boss: a recency-weighted Dirichlet over each head from ONE profile's observations, with
 *                extra weight on rounds that followed the same result (win/loss) — context, not just counts
 *   model        XGBoost, one multi-class model per head (Prepared Boss, simulation-trained; eligibility applies)
 *   oracle       evaluation only: the true heads (never available in play)
 */
import type { CombatantState } from '../game/types.js';
import { HEAD_CLASSES, HEAD_NAMES, type HeadName, type Heads } from './build-heads.js';
import { legalCandidates, type Candidate } from './candidates.js';

export type HeadProbs = { [K in HeadName]: Record<string, number> };
export type ForecasterKind = 'uniform' | 'persistence' | 'profile' | 'model' | 'oracle';
export interface Forecast { kind: ForecasterKind; heads: HeadProbs; detail?: Record<string, unknown> }

/** Floor so a never-seen choice is unlikely, never impossible (players can always surprise). */
export const PROB_FLOOR = 0.02;

export function uniformHeads(): HeadProbs {
  return Object.fromEntries(HEAD_NAMES.map((h) => [h, Object.fromEntries(HEAD_CLASSES[h].map((c) => [c, 1 / HEAD_CLASSES[h].length]))])) as HeadProbs;
}

export function oneHotHeads(t: Heads): HeadProbs {
  return Object.fromEntries(HEAD_NAMES.map((h) => [h, Object.fromEntries(HEAD_CLASSES[h].map((c) => [c, c === t[h] ? 1 : 0]))])) as HeadProbs;
}

/** Persistence baseline from the heads of this run's earlier rounds (oldest first). No history → uniform. */
export function persistenceHeads(history: Heads[]): HeadProbs {
  if (!history.length) return uniformHeads();
  const last = history[history.length - 1];
  return Object.fromEntries(HEAD_NAMES.map((h) => {
    const k = HEAD_CLASSES[h].length;
    return [h, Object.fromEntries(HEAD_CLASSES[h].map((c) => {
      const n = history.filter((x) => x[h] === c).length;
      return [c, 0.5 * (last[h] === c ? 1 : 0) + 0.5 * (n + 1) / (history.length + k)];
    }))];
  })) as HeadProbs;
}

/** What the profile forecaster learns from: the player's choice and the context it was made in. */
export interface ProfileEvidence { heads: Heads; previousWinner: 'player' | 'boss' | null }

export const PROFILE_CONFIG = {
  /** Weight of an observation k rounds ago: decay^k (recent changes count more, old habits fade, never vanish). */
  decay: 0.8,
  /** Extra weight for observations made after the same result as now (a player may react to wins and losses). */
  contextBoost: 2,
  /** Dirichlet prior strength per class (uniform: the Learning Boss starts knowing only the rules). */
  prior: 1,
  /** Weight of "repeat last round's choice" learned from how often this player actually repeated. */
  repeatMix: true,
};

/**
 * Learning Boss forecast from one profile's observations (oldest first) and the current context. Pure: the only
 * knowledge is `evidence` (no global data). With no evidence it is exactly uniform.
 */
export function profileHeads(evidence: ProfileEvidence[], now: { previousWinner: 'player' | 'boss' | null; lastHeads: Heads | null }): HeadProbs {
  if (!evidence.length) return uniformHeads();
  const n = evidence.length;
  return Object.fromEntries(HEAD_NAMES.map((h) => {
    const classes = HEAD_CLASSES[h];
    const alpha: Record<string, number> = Object.fromEntries(classes.map((c) => [c, PROFILE_CONFIG.prior]));
    evidence.forEach((e, i) => {
      const w = PROFILE_CONFIG.decay ** (n - 1 - i) * (now.previousWinner !== null && e.previousWinner === now.previousWinner ? PROFILE_CONFIG.contextBoost : 1);
      alpha[e.heads[h]] += w;
    });
    const total = Object.values(alpha).reduce((a, b) => a + b, 0);
    const freq = Object.fromEntries(classes.map((c) => [c, alpha[c] / total]));
    if (!PROFILE_CONFIG.repeatMix || !now.lastHeads || n < 2) return [h, freq];
    // How often has this player kept this head from one round to the next? (Laplace-smoothed, from evidence only.)
    let stays = 0;
    for (let i = 1; i < n; i++) if (evidence[i].heads[h] === evidence[i - 1].heads[h]) stays++;
    const r = (stays + 1) / (n - 1 + 2);
    return [h, Object.fromEntries(classes.map((c) => [c, r * (c === now.lastHeads![h] ? 1 : 0) + (1 - r) * freq[c]]))];
  })) as HeadProbs;
}

/** Blend a forecast with the uniform one: w·heads + (1−w)·uniform (w = 1 → unchanged, 0 → rules only). */
export function temperHeads(heads: HeadProbs, w: number): HeadProbs {
  const u = uniformHeads();
  return Object.fromEntries(HEAD_NAMES.map((h) => [h, Object.fromEntries(HEAD_CLASSES[h].map((c) => [c, w * (heads[h][c] ?? 0) + (1 - w) * u[h][c]]))])) as HeadProbs;
}

/** Probability of each legal candidate under a forecast (renormalised over the legal set; floor applied per head). */
export function candidateProbabilities(cands: Candidate[], heads: HeadProbs, floor = PROB_FLOOR): number[] {
  const raw = cands.map((c) => HEAD_NAMES.reduce((p, h) => p * Math.max(floor, heads[h][c.heads[h]] ?? 0), 1));
  const z = raw.reduce((a, b) => a + b, 0);
  return raw.map((x) => x / z);
}

/** Joint log loss of the true heads among the legal candidates (null when the true build is not a candidate). */
export function jointLogLoss(cands: Candidate[], heads: HeadProbs, truth: Heads, floor = PROB_FLOOR): number | null {
  const p = candidateProbabilities(cands, heads, floor);
  const key = `${truth.hands}|${truth.family}|${truth.armour}|${truth.alloc}`;
  const i = cands.findIndex((c) => c.key === key);
  return i < 0 ? null : -Math.log(Math.max(1e-12, p[i]));
}

export interface WeightedCandidate { candidate: Candidate; weight: number }

/**
 * The planner's opponent scenarios: the `k` most likely legal candidates, with weights renormalised over them.
 * `oracle` forecasts (one-hot) collapse to the true build when it is a candidate.
 */
export function topCandidates(observed: CombatantState, heads: HeadProbs, k: number, engineVersion?: string | null): { picked: WeightedCandidate[]; massCovered: number; legal: number } {
  const cands = legalCandidates(observed, engineVersion);
  const p = candidateProbabilities(cands, heads);
  const order = p.map((x, i) => [x, i] as const).sort((a, b) => b[0] - a[0] || cands[a[1]].key.localeCompare(cands[b[1]].key));
  const top = order.slice(0, k);
  const mass = top.reduce((a, [x]) => a + x, 0);
  return { picked: top.map(([x, i]) => ({ candidate: cands[i], weight: x / mass })), massCovered: mass, legal: cands.length };
}
