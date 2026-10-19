/**
 * V3 PHASE D — boss acceptance criteria (docs/V3_IMPLEMENTATION_PLAN.md §D.4) evaluated on a baseline JSON.
 *
 *   npm run v3:eval -- <baseline.json> [--out artifacts/balance]
 *
 * Reads a `npm run v3:baseline` result (no simulation here) and reports each criterion with its evidence:
 * fairness (mirror), difficulty by opponent tier, counterplay, strategic diversity, adaptation (does the boss build
 * differently against different opponents? chi-square on archetype counts), and exploit checks (stun chains, healing,
 * turn limit). Rounds inside a run are correlated, so chi-square p-values are approximate (optimistic); they are
 * reported together with effect sizes (Jensen-Shannon divergence).
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../config/env.js';
import type { AgentReport, Interval, Mechanics } from './v3-baseline.js';

export const TIERS: Record<string, string[]> = {
  T0: ['melee_bruiser', 'archer', 'shield_turtle', 'hybrid', 'piercer', 'duelist', 'random'],
  T1: ['blocker', 'dodger', 'stunner', 'healer', 'counter_puncher'],
  T2: ['adaptive', 'opportunist', 'switcher', 'reactive'],
  T3: ['mirror', 'mirror_sym'],
};
/** Proposed bands (plan §D.4, owner decision D-13 pending). */
export const BANDS: Record<string, [number, number]> = { T0: [0.7, 0.9], T1: [0.55, 0.75], T2: [0.55, 0.75], T3: [0.35, 0.6] };

const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '—');
const ci = (i: Interval) => `${pct(i.value)} [${pct(i.lo)}–${pct(i.hi)}]`;
const LATE = ['r3-5', 'r6-10'];

/** Standard normal upper tail. */
function upperTail(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z >= 0 ? p : 1 - p;
}
/** Chi-square upper-tail p-value (Wilson–Hilferty approximation). */
export function chiSquareP(x: number, df: number): number {
  if (df <= 0) return 1;
  const z = (Math.pow(x / df, 1 / 3) - (1 - 2 / (9 * df))) / Math.sqrt(2 / (9 * df));
  return upperTail(z);
}
/** Pearson chi-square test of independence on a rows × columns count table. */
export function chiSquare(table: number[][]): { x2: number; df: number; p: number } {
  const cols = table[0].map((_, j) => j).filter((j) => table.some((r) => r[j] > 0));
  const t = table.map((r) => cols.map((j) => r[j])).filter((r) => r.some((v) => v > 0));
  const total = t.flat().reduce((a, b) => a + b, 0);
  const rs = t.map((r) => r.reduce((a, b) => a + b, 0));
  const cs = t[0].map((_, j) => t.reduce((a, r) => a + r[j], 0));
  let x2 = 0;
  for (let i = 0; i < t.length; i++) for (let j = 0; j < cs.length; j++) {
    const e = (rs[i] * cs[j]) / total;
    if (e > 0) x2 += ((t[i][j] - e) ** 2) / e;
  }
  const df = (t.length - 1) * (cs.length - 1);
  return { x2, df, p: chiSquareP(x2, df) };
}
/** Jensen–Shannon divergence (bits, 0..1) between two count distributions. */
export function jsDivergence(a: Record<string, number>, b: Record<string, number>): number {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  const sa = keys.reduce((s, k) => s + (a[k] ?? 0), 0) || 1;
  const sb = keys.reduce((s, k) => s + (b[k] ?? 0), 0) || 1;
  let js = 0;
  for (const k of keys) {
    const p = (a[k] ?? 0) / sa, q = (b[k] ?? 0) / sb, m = (p + q) / 2;
    if (p > 0) js += 0.5 * p * Math.log2(p / m);
    if (q > 0) js += 0.5 * q * Math.log2(q / m);
  }
  return js;
}

const lateArchetypes = (r: AgentReport) => {
  const out: Record<string, number> = {};
  for (const st of LATE) for (const [k, v] of Object.entries(r.stages[st].bossArchetypes)) out[k] = (out[k] ?? 0) + v;
  return out;
};
/** Pooled boss win over rounds 3–10 (weighted by rounds). */
const lateWin = (r: AgentReport) => {
  const a = r.stages['r3-5'].bossWin, b = r.stages['r6-10'].bossWin;
  return (a.value * a.n + b.value * b.n) / (a.n + b.n);
};
const sumMech = (r: AgentReport): Mechanics => {
  const ms = Object.values(r.stages).map((s) => s.mechanics);
  const side = (k: keyof Mechanics) => ({ player: ms.reduce((a, m) => a + (m[k] as Record<string, number>).player, 0), boss: ms.reduce((a, m) => a + (m[k] as Record<string, number>).boss, 0) });
  return {
    rounds: ms.reduce((a, m) => a + m.rounds, 0), damage: ms.reduce((a, m) => a + m.damage, 0),
    blockTry: side('blockTry'), blockOk: side('blockOk'), dodgeTry: side('dodgeTry'), dodgeOk: side('dodgeOk'),
    counters: side('counters'), counterDamage: ms.reduce((a, m) => a + m.counterDamage, 0),
    stunned: side('stunned'), chainRounds: ms.reduce((a, m) => a + m.chainRounds, 0),
    stims: side('stims'), heal: side('heal'), turnLimitRounds: ms.reduce((a, m) => a + m.turnLimitRounds, 0),
  } as Mechanics;
};

export function evaluate(reports: AgentReport[]) {
  const by = Object.fromEntries(reports.map((r) => [r.strategy, r]));
  const lines: string[] = [];
  const verdicts: { area: string; criterion: string; result: string; pass: boolean | null }[] = [];

  // Fairness
  for (const m of TIERS.T3.filter((x) => by[x])) {
    const r = by[m];
    const ok = r.bossWin.value >= 0.45 && r.bossWin.value <= 0.6 && r.roundOneBossWin.value >= 0.4 && r.roundOneBossWin.value <= 0.6;
    verdicts.push({ area: 'Competitive fairness', criterion: `${m}: boss win 45–60% overall and in round 1`, result: `${ci(r.bossWin)}; round 1 ${ci(r.roundOneBossWin)}`, pass: ok });
  }
  // Difficulty bands
  for (const [tier, names] of Object.entries(TIERS)) {
    const [lo, hi] = BANDS[tier];
    for (const n of names.filter((x) => by[x])) {
      const v = by[n].bossWin.value;
      verdicts.push({ area: 'Difficulty by opponent tier', criterion: `${tier} ${n}: boss win ${pct(lo)}–${pct(hi)}`, result: ci(by[n].bossWin), pass: v >= lo && v <= hi });
    }
  }
  // Counterplay: every T1 champion wins ≥ 35% of rounds 3–10
  for (const n of TIERS.T1.filter((x) => by[x])) {
    const w = lateWin(by[n]);
    verdicts.push({ area: 'Counterplay', criterion: `${n}: player wins ≥ 35% of rounds 3–10`, result: `player ${pct(1 - w)}`, pass: 1 - w >= 0.35 });
  }
  // Diversity across all opponents, rounds 3–10
  const all: Record<string, number> = {};
  for (const r of reports) for (const [k, v] of Object.entries(lateArchetypes(r))) all[k] = (all[k] ?? 0) + v;
  const tot = Object.values(all).reduce((a, b) => a + b, 0);
  const shares = Object.entries(all).map(([k, v]) => [k, v / tot] as const).sort((a, b) => b[1] - a[1]);
  verdicts.push({ area: 'Strategic diversity', criterion: 'top boss archetype ≤ 40% of rounds 3–10 (all opponents)', result: `${shares[0][0]} ${pct(shares[0][1])}`, pass: shares[0][1] <= 0.4 });
  verdicts.push({ area: 'Strategic diversity', criterion: '≥ 3 boss archetypes each ≥ 10%', result: shares.map(([k, v]) => `${k} ${pct(v)}`).join(', '), pass: shares.filter(([, v]) => v >= 0.1).length >= 3 });
  // Adaptation: archetype distribution differs between T1 opponents
  const t1 = TIERS.T1.filter((x) => by[x]);
  const archKeys = [...new Set(t1.flatMap((n) => Object.keys(lateArchetypes(by[n]))))];
  if (t1.length >= 2 && archKeys.length >= 2) {
    const table = t1.map((n) => archKeys.map((k) => lateArchetypes(by[n])[k] ?? 0));
    const cs = chiSquare(table);
    let sig = 0;
    const per: string[] = [];
    for (const n of t1) {
      const rest: Record<string, number> = {};
      for (const o of t1.filter((x) => x !== n)) for (const [k, v] of Object.entries(lateArchetypes(by[o]))) rest[k] = (rest[k] ?? 0) + v;
      const tab = [archKeys.map((k) => lateArchetypes(by[n])[k] ?? 0), archKeys.map((k) => rest[k] ?? 0)];
      const c = chiSquare(tab);
      if (c.p < 0.01) sig++;
      per.push(`${n} JS ${jsDivergence(lateArchetypes(by[n]), rest).toFixed(3)}, p ${c.p < 1e-4 ? '<0.0001' : c.p.toFixed(4)}`);
    }
    verdicts.push({ area: 'Adaptation', criterion: 'boss archetype mix differs between T1 opponents (≥ 4 of 5 at p < 0.01)', result: `overall χ² ${cs.x2.toFixed(1)} (df ${cs.df}, p ${cs.p < 1e-4 ? '<0.0001' : cs.p.toFixed(4)}); ${sig}/${t1.length} differ: ${per.join('; ')}`, pass: sig >= Math.min(4, t1.length) });
  }
  // Exploit checks (pooled over every opponent)
  const mech = reports.map(sumMech);
  const rounds = mech.reduce((a, m) => a + m.rounds, 0);
  const chain = mech.reduce((a, m) => a + m.chainRounds, 0);
  const heal = mech.reduce((a, m) => a + m.heal.player + m.heal.boss, 0);
  const dmg = mech.reduce((a, m) => a + m.damage, 0);
  const tl = mech.reduce((a, m) => a + m.turnLimitRounds, 0);
  verdicts.push({ area: 'No exploits', criterion: 'stun chains (a fighter stunned 2+ times in a round) ≤ 2% of rounds', result: pct(chain / rounds), pass: chain / rounds <= 0.02 });
  verdicts.push({ area: 'No exploits', criterion: 'HP healed ≤ 25% of damage dealt', result: pct(heal / dmg), pass: heal / dmg <= 0.25 });
  verdicts.push({ area: 'No exploits', criterion: 'rounds decided by the turn limit ≤ 2%', result: pct(tl / rounds), pass: tl / rounds <= 0.02 });

  lines.push('| Area | Criterion | Result | Pass |', '|---|---|---|---|');
  for (const v of verdicts) lines.push(`| ${v.area} | ${v.criterion} | ${v.result} | ${v.pass === null ? '—' : v.pass ? '✓' : '✗'} |`);

  // Mechanic table per opponent
  lines.push('', '### V3 mechanics per opponent (all rounds)', '',
    '| Opponent | Boss win | Player block ok | Player dodge ok | Boss block ok | Boss dodge ok | Counters P/B per round | Stuns on P/B per round | Stims P/B per round | Counter dmg share |',
    '|---|---|---|---|---|---|---|---|---|---|');
  for (const [i, r] of reports.entries()) {
    const m = mech[i];
    const rate = (ok: number, n: number) => (n ? `${pct(ok / n)} (${n})` : '—');
    lines.push(`| ${r.strategy} | ${pct(r.bossWin.value)} | ${rate(m.blockOk.player, m.blockTry.player)} | ${rate(m.dodgeOk.player, m.dodgeTry.player)} | ${rate(m.blockOk.boss, m.blockTry.boss)} | ${rate(m.dodgeOk.boss, m.dodgeTry.boss)} | ${(m.counters.player / m.rounds).toFixed(2)} / ${(m.counters.boss / m.rounds).toFixed(2)} | ${(m.stunned.player / m.rounds).toFixed(2)} / ${(m.stunned.boss / m.rounds).toFixed(2)} | ${(m.stims.player / m.rounds).toFixed(2)} / ${(m.stims.boss / m.rounds).toFixed(2)} | ${pct(m.counterDamage / m.damage)} |`);
  }
  // Boss builds
  lines.push('', '### Boss archetype mix, rounds 3–10, per opponent', '', '| Opponent | Archetypes | Top late build |', '|---|---|---|');
  for (const r of reports) {
    const a = lateArchetypes(r);
    const t = Object.values(a).reduce((x, y) => x + y, 0);
    lines.push(`| ${r.strategy} | ${Object.entries(a).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${pct(v / t)}`).join(', ')} | ${r.stages['r6-10'].bossTopBuild.build} (${pct(r.stages['r6-10'].bossTopBuild.share)}) |`);
  }
  // Round-1 plans
  const r1: Record<string, number> = {};
  for (const r of reports) for (const [k, v] of Object.entries(r.roundOneBossPlans ?? {})) r1[k] = (r1[k] ?? 0) + v;
  const r1t = Object.values(r1).reduce((a, b) => a + b, 0);
  lines.push('', '### Boss round-1 plans (all opponents)', '', ...Object.entries(r1).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `- ${k}: ${pct(v / r1t)}`));
  return { verdicts, markdown: lines.join('\n') };
}

function main() {
  const file = process.argv[2];
  if (!file) throw new Error('usage: npm run v3:eval -- <baseline.json>');
  const data = JSON.parse(fs.readFileSync(path.resolve(REPO_ROOT, file), 'utf8')) as { kind: string; config: unknown; reports: AgentReport[] };
  const { markdown } = evaluate(data.reports);
  const head = `# V3 boss evaluation — ${data.kind}\n\nSource: \`${file}\` (${JSON.stringify(data.config)})\n\n`;
  const outDir = path.resolve(REPO_ROOT, process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'artifacts/balance');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, path.basename(file).replace(/\.json$/, '') + '-eval.md');
  fs.writeFileSync(out, head + markdown + '\n');
  console.log(head + markdown);
  console.error(`wrote ${path.relative(REPO_ROOT, out)}`);
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('v3-eval-cli.ts')) main();
