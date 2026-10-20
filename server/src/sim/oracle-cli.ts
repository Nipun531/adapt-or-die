/**
 * ORACLE UPPER BOUND for boss predictions (V3 ML, harness only — nothing here is used live).
 *
 *   npm run ml:oracle -- [--runs 6] [--rounds 10] [--seed oracle]
 *
 * Plays identical seeded runs (live rules, every agent + mirror) with the baseline predictor and with ORACLES that
 * tell the boss the truth before it prepares:
 *   style    — only the player's real style (P(ranged) = 0/1 from its prepared loadout; hybrids keep the prediction),
 *              the exact upper bound of the P(ranged) model,
 *   build    — the player's real prepared build (style, stats and gear),
 *   defense  — the player's real defence habit (block-/dodge-leaning persona) in the boss's Monte-Carlo,
 *   both     — both at once.
 * A predictor can at best match its oracle, so if an oracle does not improve the boss's HP margin, no model of that
 * quantity can. Differences are paired per run (same seed); the 95% CI is over runs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';
import { LIVE_RULES } from '../game/rules.js';
import { STRATEGY_NAMES } from './agents.js';
import { baselinePredict, MIRROR, playInMemoryRunWith, type RunOptions } from './balance.js';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]] : null)).filter(Boolean) as [string, string][]);
const RUNS = Number(args.runs ?? 6);
const ROUNDS = Number(args.rounds ?? 10);
const SEED = args.seed ?? 'oracle';

const VARIANTS: Record<string, RunOptions> = {
  baseline: { rules: LIVE_RULES },
  style: { rules: LIVE_RULES, oracle: { style: true } },
  build: { rules: LIVE_RULES, oracle: { build: true } },
  defense: { rules: LIVE_RULES, oracle: { defense: true } },
  both: { rules: LIVE_RULES, oracle: { build: true, defense: true } },
};

const meanCi = (xs: number[]) => {
  const n = xs.length;
  const m = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, n - 1));
  const h = 1.96 * sd / Math.sqrt(n);
  return { mean: m, lo: m - h, hi: m + h };
};

async function main() {
  const strategies = [...STRATEGY_NAMES, MIRROR];
  // runMargin[variant][strategy][i] = mean boss HP margin per round of that run
  const runMargin: Record<string, Record<string, number[]>> = {};
  const winRate: Record<string, number> = {};
  for (const [name, opts] of Object.entries(VARIANTS)) {
    runMargin[name] = {};
    let wins = 0;
    let n = 0;
    for (const s of strategies) {
      runMargin[name][s] = [];
      for (let i = 0; i < RUNS; i++) {
        const r = await playInMemoryRunWith(s, `${SEED}:${s}:${i}`, async (q) => baselinePredict(q), ROUNDS, opts);
        runMargin[name][s].push(r.rounds.reduce((a, x) => a + x.bossMargin, 0) / r.rounds.length);
        wins += r.rounds.filter((x) => x.winner === 'boss').length;
        n += r.rounds.length;
      }
    }
    winRate[name] = wins / n;
    console.log(`[oracle] ${name} done`);
  }
  const report: Record<string, unknown> = { runsPerStrategy: RUNS, rounds: ROUNDS, seed: SEED, rules: LIVE_RULES.id, variants: {} };
  console.log(`\n[oracle] paired vs baseline (${RUNS} runs × ${strategies.length} strategies × ${ROUNDS} rounds; 95% CI over runs)`);
  for (const name of Object.keys(VARIANTS)) {
    const pooled = strategies.flatMap((s) => runMargin[name][s]);
    const diffs = strategies.flatMap((s) => runMargin[name][s].map((x, i) => x - runMargin.baseline[s][i]));
    const d = meanCi(diffs);
    const byStrategy = Object.fromEntries(strategies.map((s) => [s, meanCi(runMargin[name][s].map((x, i) => x - runMargin.baseline[s][i])).mean]));
    (report.variants as Record<string, unknown>)[name] = { pooledMargin: meanCi(pooled).mean, bossWinRate: winRate[name], diffVsBaseline: d, byStrategy };
    console.log(`  ${name.padEnd(9)} margin ${meanCi(pooled).mean.toFixed(3)}  boss wins ${(winRate[name] * 100).toFixed(1)}%  Δ ${d.mean >= 0 ? '+' : ''}${d.mean.toFixed(3)} [${d.lo.toFixed(3)}, ${d.hi.toFixed(3)}]`);
  }
  console.log('\n  per strategy Δ margin (style / build / defense / both):');
  for (const s of strategies) {
    const v = (k: string) => (report.variants as any)[k].byStrategy[s] as number;
    console.log(`    ${s.padEnd(16)} ${v('style').toFixed(3).padStart(7)} ${v('build').toFixed(3).padStart(7)} ${v('defense').toFixed(3).padStart(7)} ${v('both').toFixed(3).padStart(7)}`);
  }
  const dir = path.join(env.artifactsDir, 'ml');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `oracle-${SEED}.json`);
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\n[oracle] wrote ${out}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
