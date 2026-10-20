/**
 * BOSS DECISION OUTCOMES for model candidates (no database).
 *
 * Prediction quality is not the goal — better boss decisions are. This plays the same seeded in-memory games
 * (sim/balance.ts → identical agents, seeds and rules; only the boss's P(ranged) source differs) with:
 *   baseline  — the transparent baseline (what the boss uses without a model)
 *   model     — the raw XGBoost model
 *   ensemble  — w·model + (1−w)·baseline
 * and compares the boss's mean HP margin per round (boss HP left if it won, −player HP left if it lost).
 * Every predictor applies the same rule-level feasibility first (P = 0 when ranged is impossible), as in prepare.ts.
 *
 * Fresh seeds (`decision-check:*`) = held-out runs. `mirror` (a player using the boss's own policy) never appears in
 * any training data = an unseen, adaptive style.
 */
import { LIVE_RULES } from '../game/rules.js';
import { STRATEGY_NAMES } from '../sim/agents.js';
import { baselinePredict, MIRROR, playInMemoryRunWith, type InMemoryPredictor, type RunOptions } from '../sim/balance.js';
import { baselineProbability, buildFeatures, rangedFeasibility } from './features.js';
import { blendProbability, scoreWithModel } from './predictor.js';

/** A candidate passes when, on identical games, the boss does not decide worse than with the baseline. */
export const DECISION_RULE = {
  runsPerStrategy: 6,
  maxPooledDrop: 0.01,        // pooled mean HP margin ≥ baseline − 0.01
  maxUnseenDrop: 0.02,        // vs the unseen `mirror` style ≥ baseline − 0.02
};

export function modelPredictor(modelPath: string, weight: number): InMemoryPredictor {
  return async ({ records, observed }) => {
    if (!rangedFeasibility(observed).rangedFeasible) return 0; // rule — no model asked (as in prepare.ts)
    const b = baselineProbability(records);
    if (!records.length) return b; // no features yet → same as the predictor's "no evidence" path
    const r = await scoreWithModel(modelPath, modelPath, buildFeatures(records));
    if (!r.ok) throw new Error(r.error);
    return weight >= 1 ? r.p : blendProbability(r.p, b, weight);
  };
}

export interface OutcomeRow { strategy: string; rounds: number; meanMargin: number; bossWinRate: number }
/** `runMargins`: mean margin per run, in a fixed (strategy, run) order → paired across predictors. */
export type Outcomes = Record<string, { byStrategy: OutcomeRow[]; pooledMargin: number; pooledWinRate: number; runMargins: number[] }>;

export async function decisionOutcomes(predictors: Record<string, InMemoryPredictor>, opts: { runsPerStrategy?: number; seed?: string; maxRounds?: number; run?: RunOptions } = {}): Promise<Outcomes> {
  const runs = opts.runsPerStrategy ?? DECISION_RULE.runsPerStrategy;
  const strategies = [...STRATEGY_NAMES, MIRROR];
  const out: Outcomes = {};
  for (const [name, predict] of Object.entries(predictors)) {
    const byStrategy: OutcomeRow[] = [];
    const runMargins: number[] = [];
    let m = 0;
    let w = 0;
    let n = 0;
    for (const s of strategies) {
      let sm = 0;
      let sw = 0;
      let sn = 0;
      for (let i = 0; i < runs; i++) {
        // The games are played under the LIVE rules (engine 3.x) unless a caller passes other run options.
        const r = await playInMemoryRunWith(s, `${opts.seed ?? 'decision-check'}:${s}:${i}`, predict, opts.maxRounds ?? 10, opts.run ?? { rules: LIVE_RULES });
        runMargins.push(r.rounds.reduce((a, x) => a + x.bossMargin, 0) / r.rounds.length);
        for (const rd of r.rounds) {
          sm += rd.bossMargin;
          sw += rd.winner === 'boss' ? 1 : 0;
          sn++;
        }
      }
      byStrategy.push({ strategy: s, rounds: sn, meanMargin: sm / sn, bossWinRate: sw / sn });
      m += sm;
      w += sw;
      n += sn;
    }
    out[name] = { byStrategy, pooledMargin: m / n, pooledWinRate: w / n, runMargins };
  }
  return out;
}

export function decisionVerdict(o: Outcomes, candidate: string): { ok: boolean; reasons: string[] } {
  const base = o.baseline;
  const cand = o[candidate];
  const reasons: string[] = [];
  const pooledOk = cand.pooledMargin >= base.pooledMargin - DECISION_RULE.maxPooledDrop;
  reasons.push(`${pooledOk ? 'PASS' : 'FAIL'}: boss decisions (same seeded games): pooled HP margin ${cand.pooledMargin.toFixed(3)} vs baseline ${base.pooledMargin.toFixed(3)} (allowed drop ${DECISION_RULE.maxPooledDrop})`);
  const um = (x: typeof base) => x.byStrategy.find((r) => r.strategy === MIRROR)!.meanMargin;
  const unseenOk = um(cand) >= um(base) - DECISION_RULE.maxUnseenDrop;
  reasons.push(`${unseenOk ? 'PASS' : 'FAIL'}: unseen adaptive style (mirror): HP margin ${um(cand).toFixed(3)} vs baseline ${um(base).toFixed(3)} (allowed drop ${DECISION_RULE.maxUnseenDrop})`);
  const d = pairedDiff(cand.runMargins, base.runMargins);
  reasons.push(`INFO: paired Δ HP margin vs baseline ${d.mean >= 0 ? '+' : ''}${d.mean.toFixed(3)}, 95% CI [${d.lo.toFixed(3)}, ${d.hi.toFixed(3)}] over ${cand.runMargins.length} runs — ${d.lo > 0 ? 'a measurable improvement' : 'no measurable improvement'}`);
  return { ok: pooledOk && unseenOk, reasons };
}

/** Mean of paired per-run differences with a normal 95% CI (used to call a decision improvement measurable). */
export function pairedDiff(a: number[], b: number[]): { mean: number; lo: number; hi: number } {
  const xs = a.map((x, i) => x - b[i]);
  const n = xs.length;
  const mean = xs.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, n - 1));
  const h = (1.96 * sd) / Math.sqrt(n);
  return { mean, lo: mean - h, hi: mean + h };
}

export const baselineInMemory: InMemoryPredictor = async (req) => baselinePredict(req);
