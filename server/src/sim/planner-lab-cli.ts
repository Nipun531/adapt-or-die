/**
 * PLANNER LAB (post-V4, docs/ML_WALKTHROUGH.md §15) — harness only, nothing here changes live play.
 *
 *   npm run ml:planner-lab -- [--runs 8] [--rounds 10] [--seed v4-oracle] [--only a,b] [--headroom]
 *
 * Question: which planner change, if any, turns ORACLE build knowledge into a measurable gain? Same seeded runs as
 * `ml:v4-oracle` (live rules, 21 agents + mirror); only the boss's opponent scenarios and planner knobs differ.
 * Paired Δ of the boss's mean HP margin vs the live planner (v3-baseline), 95% CI over runs.
 *
 * --headroom: on the live planner's own games, per round, how much better could ANY plan have done against the
 * player's real build? Compares the live pick with the best plan found by an exact-build planner (top 40 plans,
 * 200 fights, no diversity band), both re-scored with 400 fresh fights vs the real build and the agent's defence.
 */
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';
import { applyPlan, choosePlan, simulatedOutcome, V4_SEARCH, type PlannerOptions } from '../boss/policy.js';
import { persistenceHeads, uniformHeads } from '../boss/forecast.js';
import { snapshotOf } from '../game/derive.js';
import { LIVE_RULES } from '../game/rules.js';
import { deriveSeed, Rng } from '../game/rng.js';
import { STRATEGY_NAMES } from './agents.js';
import { baselinePredict, exactScenario, MIRROR, playInMemoryRunWith, type InMemoryPredictor, type RoundDiagnostic, type RunOptions, type RunResult } from './balance.js';
import { AGENT_DEFENSE, defenseChooserFor } from './v3-policies.js';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') ? 'true' : all[i + 1] ?? 'true'] : null)).filter(Boolean) as [string, string][]);
const RUNS = Number(args.runs ?? 8);
const ROUNDS = Number(args.rounds ?? 10);
const SEED = args.seed ?? 'v4-oracle';
/** First run index (shard a long experiment over processes: --offset 8 --runs 8 = runs 8..15). */
const OFFSET = Number(args.offset ?? 0);

const meanCi = (xs: number[]) => {
  const n = xs.length;
  const m = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, n - 1));
  const h = (1.96 * sd) / Math.sqrt(n);
  return { mean: m, lo: m - h, hi: m + h, n };
};

const live: RunOptions = { rules: LIVE_RULES };
const base: InMemoryPredictor = async (q) => baselinePredict(q);
const uni: InMemoryPredictor = async () => ({ heads: uniformHeads() });
const pers: InMemoryPredictor = async (q) => ({ heads: persistenceHeads(q.historyHeads) });
const BIG: PlannerOptions = { fightBudget: 160 };
const MAX: PlannerOptions = { fightBudget: 160, topK: 30, band: 0 };

// 'v3-baseline' and every knob below are relative to the V4 search settings (the live planner when §15 was run), so
// these numbers stay reproducible after the live config changed; each condition's planner fields override V4_SEARCH.
const RAW: Record<string, { predict: InMemoryPredictor; opts: RunOptions }> = {
  'v3-baseline': { predict: base, opts: live },
  // Information only (live knobs).
  'oracle-build': { predict: base, opts: { ...live, oracle: { build: true } } },
  'oracle-heads': { predict: uni, opts: { ...live, oracle: { heads: true } } },
  exact: { predict: base, opts: { ...live, oracle: { exact: true } } },
  'exact-def': { predict: base, opts: { ...live, oracle: { exact: true, defense: true } } },
  // Monte-Carlo budget and plan-space knobs.
  'base-mc160': { predict: base, opts: { ...live, planner: BIG } },
  'base-greedy': { predict: base, opts: { ...live, planner: { band: 0 } } },
  'base-max': { predict: base, opts: { ...live, planner: MAX } },
  'exact-mc160': { predict: base, opts: { ...live, oracle: { exact: true }, planner: BIG } },
  'exact-greedy': { predict: base, opts: { ...live, oracle: { exact: true }, planner: { band: 0 } } },
  'exact-max': { predict: base, opts: { ...live, oracle: { exact: true, defense: true }, planner: MAX } },
  'heads-max': { predict: uni, opts: { ...live, oracle: { heads: true }, planner: MAX } },
  'pers-max': { predict: pers, opts: { ...live, planner: MAX } },
  // Knob ablation: only a wider Monte-Carlo shortlist (top 30 analytic plans instead of 6), live budget and band.
  'base-top30': { predict: base, opts: { ...live, planner: { topK: 30 } } },
  'exact-top30': { predict: base, opts: { ...live, oracle: { exact: true }, planner: { topK: 30 } } },
  // Live candidate: shortlist 30 and 160 fights, but KEEP the diversity band (does the gain need band 0?).
  'base-wide': { predict: base, opts: { ...live, planner: { topK: 30, fightBudget: 160 } } },
  // Objective: worst case / minimax regret instead of the expected margin.
  'base-worst': { predict: base, opts: { ...live, planner: { objective: 'worst' } } },
  'base-regret': { predict: base, opts: { ...live, planner: { objective: 'regret' } } },
  'uniform-worst': { predict: uni, opts: { ...live, planner: { objective: 'worst' } } },
  'uniform-regret': { predict: uni, opts: { ...live, planner: { objective: 'regret' } } },
  'pers-regret': { predict: pers, opts: { ...live, planner: { objective: 'regret' } } },
  'heads-regret': { predict: uni, opts: { ...live, oracle: { heads: true }, planner: { objective: 'regret' } } },
};

const CONDS = Object.fromEntries(Object.entries(RAW).map(([k, c]) => [k, { ...c, opts: { ...c.opts, planner: { ...V4_SEARCH, ...c.opts.planner }, mirrorPlanner: V4_SEARCH } }]));

/** Per-round headroom on the live planner's games (see the header). */
function headroomProbe(rows: { strategy: string; same: boolean; gain: number; liveExactGain: number }[]) {
  return (d: RoundDiagnostic) => {
    const sc = exactScenario(d.player);
    const def = (tag: string) => d.strategy === MIRROR ? undefined
      : defenseChooserFor(AGENT_DEFENSE[d.strategy] ?? 'smart', new Rng(deriveSeed(d.runSeed, `headroom-${tag}:${d.roundNumber}`)), d.rules);
    const seed = String(deriveSeed(d.runSeed, `boss:${d.roundNumber}`));
    const best = choosePlan({ boss: d.boss, observedPlayer: d.player, pRanged: null, seed, rules: d.rules, opponents: [sc], playerDefense: def('plan'), planner: { fightBudget: 200, topK: 40, band: 0 } }).selected;
    const liveExact = choosePlan({ boss: d.boss, observedPlayer: d.player, pRanged: null, seed, rules: d.rules, opponents: [sc], planner: V4_SEARCH }).selected;
    const score = (p: typeof best) => simulatedOutcome(snapshotOf(applyPlan(d.boss, p)), sc, `${d.runSeed}:headroom:${d.roundNumber}`, 400, d.rules, def('eval')).margin;
    const chosen = score(d.policy.selected);
    rows.push({ strategy: d.strategy, same: best.label === d.policy.selected.label, gain: score(best) - chosen, liveExactGain: score(liveExact) - chosen });
  };
}

async function main() {
  const only = args.only ? new Set(['v3-baseline', ...args.only.split(',')]) : null;
  const strategies = [...STRATEGY_NAMES, MIRROR];
  const results: Record<string, Record<string, RunResult[]>> = {};
  const headroom: { strategy: string; same: boolean; gain: number; liveExactGain: number }[] = [];
  for (const [name, c] of Object.entries(CONDS)) {
    if (only && !only.has(name)) continue;
    const opts = name === 'v3-baseline' && args.headroom ? { ...c.opts, diagnose: headroomProbe(headroom) } : c.opts;
    results[name] = {};
    const t0 = Date.now();
    for (const s of strategies) {
      results[name][s] = [];
      for (let i = OFFSET; i < OFFSET + RUNS; i++) results[name][s].push(await playInMemoryRunWith(s, `${SEED}:${s}:${i}`, c.predict, ROUNDS, opts));
    }
    console.log(`[planner-lab] ${name} done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  const margin = (r: RunResult) => r.rounds.reduce((a, x) => a + x.bossMargin, 0) / r.rounds.length;
  const report: any = { runsPerStrategy: RUNS, offset: OFFSET, rounds: ROUNDS, seed: SEED, rules: LIVE_RULES.id, conditions: {},
    // Per-run mean margins (strategy → run order), so shards and any pair of conditions can be combined later.
    perRun: Object.fromEntries(Object.entries(results).map(([n, r]) => [n, Object.fromEntries(strategies.map((s) => [s, r[s].map(margin)]))])) };
  console.log(`\n[planner-lab] paired vs v3-baseline (${RUNS} runs × ${strategies.length} strategies × ${ROUNDS} rounds; 95% CI over runs)`);
  for (const name of Object.keys(results)) {
    const all = strategies.flatMap((s) => results[name][s]);
    const diffs = strategies.flatMap((s) => results[name][s].map((r, i) => margin(r) - margin(results['v3-baseline'][s][i])));
    const wins = all.reduce((a, r) => a + r.rounds.filter((x) => x.winner === 'boss').length, 0) / all.reduce((a, r) => a + r.rounds.length, 0);
    const d = meanCi(diffs);
    const byStrategy = Object.fromEntries(strategies.map((s) => [s, meanCi(results[name][s].map((r, i) => margin(r) - margin(results['v3-baseline'][s][i]))).mean]));
    const noMirror = meanCi(strategies.filter((s) => s !== MIRROR).flatMap((s) => results[name][s].map((r, i) => margin(r) - margin(results['v3-baseline'][s][i]))));
    report.conditions[name] = { pooledMargin: meanCi(all.map(margin)).mean, bossWinRate: wins, diffVsV3Baseline: d, diffWithoutMirror: noMirror, byStrategy };
    const f = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(3)}`;
    console.log(`  ${name.padEnd(15)} margin ${meanCi(all.map(margin)).mean.toFixed(3)}  boss wins ${(wins * 100).toFixed(1)}%  Δ ${f(d.mean)} [${f(d.lo)}, ${f(d.hi)}]  no-mirror ${f(noMirror.mean)} [${f(noMirror.lo)}, ${f(noMirror.hi)}]  mirror ${f(byStrategy[MIRROR])}`);
  }
  if (headroom.length) {
    const g = meanCi(headroom.map((h) => h.gain));
    const le = meanCi(headroom.map((h) => h.liveExactGain));
    const nm = meanCi(headroom.filter((h) => h.strategy !== MIRROR).map((h) => h.gain));
    report.headroom = { rounds: headroom.length, samePlan: headroom.filter((h) => h.same).length / headroom.length, bestGain: g, bestGainNoMirror: nm, liveKnobsExactGain: le,
      byStrategy: Object.fromEntries(strategies.map((s) => [s, meanCi(headroom.filter((h) => h.strategy === s).map((h) => h.gain)).mean])) };
    console.log(`\n  headroom (${headroom.length} live rounds): best exact plan = live pick in ${(100 * report.headroom.samePlan).toFixed(1)}%`);
    console.log(`    per-round margin gain, best exact plan vs live pick: ${g.mean.toFixed(3)} [${g.lo.toFixed(3)}, ${g.hi.toFixed(3)}] (no mirror ${nm.mean.toFixed(3)})`);
    console.log(`    same, exact build but live knobs:                    ${le.mean.toFixed(3)} [${le.lo.toFixed(3)}, ${le.hi.toFixed(3)}]`);
    for (const s of strategies) console.log(`      ${s.padEnd(16)} ${report.headroom.byStrategy[s].toFixed(3)}`);
  }
  const dir = path.join(env.artifactsDir, 'ml', 'v4');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `planner-lab-${SEED}${OFFSET ? `-o${OFFSET}` : ''}${only ? `-${[...only].filter((x) => x !== 'v3-baseline').join('+') || 'base'}` : ''}${args.headroom ? '-headroom' : ''}.json`);
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\n[planner-lab] wrote ${out}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
