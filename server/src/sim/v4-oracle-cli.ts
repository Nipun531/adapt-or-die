/**
 * V4 NEXT-BUILD ORACLE EXPERIMENT (mandatory, docs/V4_IMPLEMENTATION_PLAN.md §4) — harness only.
 *
 *   npm run ml:v4-oracle -- [--runs 8] [--rounds 10] [--seed v4-oracle] [--model <dir>] [--only a,b]
 *
 * Identical seeded runs (live rules, every agent + mirror); only the boss's opponent model differs:
 *   C0 v3-baseline   today's planner: reachable scenarios weighted by the P(ranged) baseline
 *   C1 uniform       V4 legal candidates, all equally likely (no prediction — the ablation)
 *   C2 persistence   V4 candidates weighted by the per-head persistence baseline (this run's history only)
 *   C3 model         V4 candidates weighted by the XGBoost head models (only with --model; v3w-model reweights V3 builds)
 *   C4 oracle-heads  V4 candidates weighted by the TRUE heads (evaluation-only upper bound of a head predictor)
 *   C5 oracle-build  the planner sees the exact real build (the V3 bound)
 * Paired Δ vs C0 with a 95% CI over runs. Forecast quality (joint log loss among legal candidates, coverage) is
 * measured on the C0 games, where the player's choices do not depend on the forecaster.
 */
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';
import { HEAD_NAMES } from '../boss/build-heads.js';
import { legalCandidates } from '../boss/candidates.js';
import { jointLogLoss, persistenceHeads, uniformHeads, type HeadProbs } from '../boss/forecast.js';
import { LIVE_RULES } from '../game/rules.js';
import { STRATEGY_NAMES } from './agents.js';
import { baselinePredict, MIRROR, playInMemoryRunWith, type InMemoryPredictor, type RunOptions, type RunResult } from './balance.js';
import { headModelPredictor } from '../ml/build-predictor.js';
import { stopInferenceWorker } from '../ml/predictor.js';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]] : null)).filter(Boolean) as [string, string][]);
const RUNS = Number(args.runs ?? 8);
const ROUNDS = Number(args.rounds ?? 10);
const SEED = args.seed ?? 'v4-oracle';

export const meanCi = (xs: number[]) => {
  const n = xs.length;
  const m = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, n - 1));
  const h = (1.96 * sd) / Math.sqrt(n);
  return { mean: m, lo: m - h, hi: m + h, n };
};

async function main() {
  const live: RunOptions = { rules: LIVE_RULES };
  const conds: Record<string, { predict: InMemoryPredictor; opts: RunOptions }> = {
    'v3-baseline': { predict: async (q) => baselinePredict(q), opts: live },
    uniform: { predict: async () => ({ heads: uniformHeads() }), opts: live },
    persistence: { predict: async (q) => ({ heads: persistenceHeads(q.historyHeads) }), opts: live },
    'oracle-heads': { predict: async () => ({ heads: uniformHeads() }), opts: { ...live, oracle: { heads: true } } },
    'oracle-build': { predict: async (q) => baselinePredict(q), opts: { ...live, oracle: { build: true } } },
    // Same head forecasts, but reweighting the V3 reachable builds (does head knowledge help with V3's builds?).
    'v3w-persistence': { predict: async (q) => ({ heads: persistenceHeads(q.historyHeads) }), opts: { ...live, scenarioBase: 'v3' } },
    'v3w-oracle': { predict: async () => ({ heads: uniformHeads() }), opts: { ...live, scenarioBase: 'v3', oracle: { heads: true } } },
  };
  if (args.model) {
    conds.model = { predict: headModelPredictor(args.model), opts: live };
    conds['v3w-model'] = { predict: headModelPredictor(args.model), opts: { ...live, scenarioBase: 'v3' } };
  }
  const only = args.only ? new Set(['v3-baseline', ...args.only.split(',')]) : null;
  const strategies = [...STRATEGY_NAMES, MIRROR];
  const results: Record<string, Record<string, RunResult[]>> = {};
  for (const [name, c] of Object.entries(conds)) {
    if (only && !only.has(name)) continue;
    results[name] = {};
    const t0 = Date.now();
    for (const s of strategies) {
      results[name][s] = [];
      for (let i = 0; i < RUNS; i++) results[name][s].push(await playInMemoryRunWith(s, `${SEED}:${s}:${i}`, c.predict, ROUNDS, c.opts));
    }
    console.log(`[v4-oracle] ${name} done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  const margin = (r: RunResult) => r.rounds.reduce((a, x) => a + x.bossMargin, 0) / r.rounds.length;
  const report: any = { runsPerStrategy: RUNS, rounds: ROUNDS, seed: SEED, rules: LIVE_RULES.id, conditions: {}, forecastQuality: {} };
  console.log(`\n[v4-oracle] paired vs v3-baseline (${RUNS} runs × ${strategies.length} strategies × ${ROUNDS} rounds; 95% CI over runs)`);
  for (const name of Object.keys(results)) {
    const all = strategies.flatMap((s) => results[name][s]);
    const diffs = strategies.flatMap((s) => results[name][s].map((r, i) => margin(r) - margin(results['v3-baseline'][s][i])));
    const wins = all.reduce((a, r) => a + r.rounds.filter((x) => x.winner === 'boss').length, 0) / all.reduce((a, r) => a + r.rounds.length, 0);
    const d = meanCi(diffs);
    const byStrategy = Object.fromEntries(strategies.map((s) => [s, meanCi(results[name][s].map((r, i) => margin(r) - margin(results['v3-baseline'][s][i]))).mean]));
    report.conditions[name] = { pooledMargin: meanCi(all.map(margin)).mean, bossWinRate: wins, diffVsV3Baseline: d, byStrategy };
    console.log(`  ${name.padEnd(13)} margin ${meanCi(all.map(margin)).mean.toFixed(3)}  boss wins ${(wins * 100).toFixed(1)}%  Δ ${d.mean >= 0 ? '+' : ''}${d.mean.toFixed(3)} [${d.lo.toFixed(3)}, ${d.hi.toFixed(3)}]`);
  }
  console.log('\n  per strategy Δ margin vs v3-baseline:');
  const names = Object.keys(results).filter((n) => n !== 'v3-baseline');
  console.log(`    ${''.padEnd(16)} ${names.map((n) => n.slice(0, 12).padStart(13)).join('')}`);
  for (const s of strategies) console.log(`    ${s.padEnd(16)} ${names.map((n) => report.conditions[n].byStrategy[s].toFixed(3).padStart(13)).join('')}`);

  // Forecast quality on the v3-baseline games (the player's choices there do not depend on the V4 forecaster).
  const fq: Record<string, number[]> = { uniform: [], persistence: [] };
  let covered = 0;
  let total = 0;
  const byRound: Record<string, Record<number, number[]>> = { uniform: {}, persistence: {} };
  for (const s of strategies) for (const r of results['v3-baseline'][s]) {
    r.rounds.forEach((rd, i) => {
      const cands = legalCandidates(rd.observed);
      total++;
      const f: Record<string, HeadProbs> = { uniform: uniformHeads(), persistence: persistenceHeads(r.rounds.slice(0, i).map((x) => x.truthHeads)) };
      const lu = jointLogLoss(cands, f.uniform, rd.truthHeads);
      if (lu === null) return;
      covered++;
      for (const k of Object.keys(f)) {
        const l = jointLogLoss(cands, f[k], rd.truthHeads)!;
        fq[k].push(l);
        (byRound[k][rd.roundNumber] ??= []).push(l);
      }
    });
  }
  report.forecastQuality = {
    coverage: covered / total, rows: covered,
    jointLogLoss: Object.fromEntries(Object.entries(fq).map(([k, v]) => [k, meanCi(v)])),
    byRound: Object.fromEntries(Object.entries(byRound).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([n, xs]) => [n, meanCi(xs).mean]))])),
    heads: HEAD_NAMES,
  };
  console.log(`\n  forecast quality (v3-baseline games): true build is a legal candidate in ${(100 * covered / total).toFixed(1)}% of ${total} rounds`);
  for (const [k, v] of Object.entries(fq)) { const c = meanCi(v); console.log(`    ${k.padEnd(12)} joint log loss ${c.mean.toFixed(3)} [${c.lo.toFixed(3)}, ${c.hi.toFixed(3)}]`); }
  const dir = path.join(env.artifactsDir, 'ml', 'v4');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `oracle-${SEED}${args.model ? '-model' : ''}.json`);
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\n[v4-oracle] wrote ${out}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => stopInferenceWorker());
