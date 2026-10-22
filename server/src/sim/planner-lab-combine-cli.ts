/**
 * Combine sharded planner-lab reports (`--offset`) and print paired Δ with 95% CIs over runs for any condition pair.
 *
 *   npm run ml:planner-lab-combine -- [--seed v4-oracle] [--pairs exact-max:base-max,heads-max:base-max]
 *
 * Reads artifacts/ml/v4/planner-lab-<seed>*.json files that carry `perRun`. Every condition is paired with
 * v3-baseline; `--pairs a:b` adds a − b on the same seeds (e.g. the value of information at a fixed planner).
 */
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]] : null)).filter(Boolean) as [string, string][]);
const SEED = args.seed ?? 'v4-oracle';
const MIRROR = 'mirror';

const meanCi = (xs: number[]) => {
  const n = xs.length;
  const m = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, n - 1));
  const h = (1.96 * sd) / Math.sqrt(n);
  return { mean: m, lo: m - h, hi: m + h, n };
};

const dir = path.join(env.artifactsDir, 'ml', 'v4');
/** condition → strategy → run index → mean margin */
const runs: Record<string, Record<string, Map<number, number>>> = {};
for (const f of fs.readdirSync(dir).filter((x) => x.startsWith(`planner-lab-${SEED}`) && x.endsWith('.json'))) {
  const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  if (!r.perRun || r.seed !== SEED) continue;
  for (const [c, byS] of Object.entries(r.perRun as Record<string, Record<string, number[]>>)) {
    for (const [s, xs] of Object.entries(byS)) xs.forEach((x, i) => ((runs[c] ??= {})[s] ??= new Map()).set((r.offset ?? 0) + i, x));
  }
}

const paired = (a: string, b: string, keep: (s: string) => boolean = () => true) => {
  const d: number[] = [];
  for (const [s, m] of Object.entries(runs[a] ?? {})) {
    if (!keep(s)) continue;
    for (const [i, x] of m) { const y = runs[b]?.[s]?.get(i); if (y !== undefined) d.push(x - y); }
  }
  return meanCi(d);
};
const f = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(3)}`;
const line = (a: string, b: string) => {
  const all = paired(a, b);
  const nm = paired(a, b, (s) => s !== MIRROR);
  const mir = paired(a, b, (s) => s === MIRROR).mean;
  console.log(`  ${`${a} − ${b}`.padEnd(30)} n=${String(all.n).padStart(4)}  Δ ${f(all.mean)} [${f(all.lo)}, ${f(all.hi)}]  no-mirror ${f(nm.mean)} [${f(nm.lo)}, ${f(nm.hi)}]  mirror ${f(mir)}`);
  return { a, b, all, noMirror: nm, mirror: mir };
};

const out: unknown[] = [];
console.log(`[planner-lab-combine] seed ${SEED}; paired over runs (strategy × run index)`);
for (const c of Object.keys(runs)) if (c !== 'v3-baseline') out.push(line(c, 'v3-baseline'));
for (const p of (args.pairs ?? '').split(',').filter(Boolean)) { const [a, b] = p.split(':'); out.push(line(a, b)); }
const file = path.join(dir, `planner-lab-combined-${SEED}.json`);
fs.writeFileSync(file, JSON.stringify(out, null, 2));
console.log(`[planner-lab-combine] wrote ${file}`);
