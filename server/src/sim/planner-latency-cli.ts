/**
 * Boss decision LATENCY per planner config (no database):  npm run boss:latency -- [--runs 2]
 *
 * Collects the real pre-round states of in-memory runs (every agent + mirror, live rules), then times choosePlan on
 * each state with the live config and with the planner-lab candidates (docs/ML_WALKTHROUGH.md §15). One process,
 * sequential, so the numbers are single-core wall time per decision (the server prepares the boss inside a request).
 */
import { choosePlan, V4_SEARCH, type PlannerOptions } from '../boss/policy.js';
import { LIVE_RULES } from '../game/rules.js';
import { STRATEGY_NAMES } from './agents.js';
import { MIRROR, playInMemoryRun, type RoundDiagnostic } from './balance.js';

const i = process.argv.indexOf('--runs');
const RUNS = i >= 0 ? Number(process.argv[i + 1]) : 2;

const CONFIGS: Record<string, PlannerOptions | undefined> = {
  'V4 (top 6, 40 fights, band 0.03)': V4_SEARCH,
  'top 30, 160 fights, band 0.03': { topK: 30, fightBudget: 160, band: 0.03 },
  'live (top 30, 160, band 0)': undefined,
};

const states: RoundDiagnostic[] = [];
for (const s of [...STRATEGY_NAMES, MIRROR]) {
  for (let r = 0; r < RUNS; r++) playInMemoryRun(s, `latency:${s}:${r}`, 10, { rules: LIVE_RULES, diagnose: (d) => states.push(d) });
}
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))];
console.log(`[latency] ${states.length} real boss decisions (${RUNS} runs × ${STRATEGY_NAMES.length + 1} strategies × 10 rounds)`);
for (const [name, planner] of Object.entries(CONFIGS)) {
  const ms: number[] = [];
  for (const d of states) {
    const t0 = performance.now();
    choosePlan({ boss: d.boss, observedPlayer: d.observed, pRanged: null /* both styles: the full scenario set */, seed: `lat:${d.roundNumber}`, rules: d.rules, planner });
    ms.push(performance.now() - t0);
  }
  const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
  console.log(`  ${name.padEnd(34)} mean ${mean.toFixed(0)} ms  p50 ${pct(ms, 0.5).toFixed(0)}  p95 ${pct(ms, 0.95).toFixed(0)}  max ${Math.max(...ms).toFixed(0)} ms`);
}
