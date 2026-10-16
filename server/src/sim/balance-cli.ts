/**
 * Balance study CLI (no database):  npm run balance -- [--fights 60] [--runs 40] [--out artifacts/balance]
 *
 * Runs the full V2 balance study and writes report.json + report.md:
 *  1. weapon matrix with the user's original pierce values vs the tuned (live) values;
 *  2. pierce viability per bracket (combined score + rank among its price-bracket peers);
 *  3. full in-memory runs: every agent + the symmetric "mirror" player vs the real boss policy;
 *  4. proposal experiments for problems pierce cannot fix (temporary item overrides, nothing is saved).
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../config/env.js';
import { ITEMS, requireItem } from '../game/catalog.js';
import { STRATEGY_NAMES } from './agents.js';
import {
  bracketOf, combined, itemUsage, MIRROR, playInMemoryRun, summarizeRuns, TIERS, tierFor, weaponMatrix, withItems,
  type ItemOverride, type RunBatchSummary, type WeaponRow,
} from './balance.js';

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};
const FIGHTS = Number(arg('fights', '60'));
const RUNS = Number(arg('runs', '40'));
const OUT = path.resolve(REPO_ROOT, arg('out', 'artifacts/balance'));

/** The user's original V2 pierce values (V2_DEMANDS §2.1), before tuning. */
export const USER_PIERCE: Record<string, { chance: number; defIgnore: number }> = {
  rapier: { chance: 0.05, defIgnore: 0.7 }, flail: { chance: 0.2, defIgnore: 0.5 }, bow: { chance: 0.3, defIgnore: 0.3 },
  crossbow: { chance: 0.25, defIgnore: 0.45 }, longbow: { chance: 0.4, defIgnore: 0.55 }, spear: { chance: 0.1, defIgnore: 0.25 },
  lance: { chance: 0.2, defIgnore: 0.35 }, pike: { chance: 0.35, defIgnore: 0.6 },
};
const userOverrides = Object.fromEntries(Object.entries(USER_PIERCE).map(([id, p]) => [id, { pierce: p }])) as Record<string, ItemOverride>;

const EXPERIMENTS: { name: string; why: string; overrides: Record<string, ItemOverride> }[] = [
  {
    name: 'E1 Flail and Lance STR +2',
    why: 'Pierce alone cannot lift Flail/Lance to their bracket median (even at 100%/100%).',
    overrides: { flail: { mods: { str: 6 } }, lance: { mods: { str: 7 } } },
  },
  {
    name: 'E4 Pike STR +7→+9',
    why: 'Pike stays last in the late bracket even at 60%/90% pierce; its DEX −1 and low STR for 42 gold are the problem.',
    overrides: { pike: { mods: { str: 9 } } },
  },
  {
    name: 'E2 Crossbow DEX +4→+3, Rapier DEX +3→+2',
    why: 'Crossbow and Rapier top their brackets by a wide margin because DEX double-dips.',
    overrides: { crossbow: { mods: { dex: 3 } }, rapier: { mods: { dex: 2 } } },
  },
  {
    name: 'E3 Heavy gear DEX penalties halved',
    why: 'Heavy Armor / Great Shield / Small Shield push effective DEX to the floor (1), so DEF builds — the target of pierce — never work.',
    overrides: { heavy_armour: { mods: { dex: -2 } }, great_shield: { mods: { dex: -3 } }, small_shield: { mods: { dex: -1 } } },
  },
];

const pct = (x: number) => `${Math.round(x * 100)}%`;
const f2 = (x: number) => x.toFixed(2);

function ranksByBracket(rows: WeaponRow[]) {
  const out: { tier: string; weapon: string; pierce: string; combined: number; rank: number; of: number; vs: WeaponRow['vs']; build: string }[] = [];
  for (const t of TIERS) {
    const ids = new Set(bracketOf(t).map((i) => i.id));
    const inB = rows.filter((r) => r.tier === t.name && ids.has(r.weapon)).sort((a, b) => combined(b) - combined(a));
    inB.forEach((r, i) => out.push({ tier: t.name, weapon: r.weapon, pierce: r.pierce, combined: combined(r), rank: i + 1, of: inB.length, vs: r.vs, build: r.build }));
  }
  return out;
}

function runAll(runs: number, label: string): { summary: RunBatchSummary[]; usage: ReturnType<typeof itemUsage> } {
  const strategies = [...STRATEGY_NAMES, MIRROR];
  const results = strategies.flatMap((s) => Array.from({ length: runs }, (_, i) => playInMemoryRun(s, `${label}:${s}:${i}`, 10)));
  return { summary: summarizeRuns(results), usage: itemUsage(results) };
}

function bracketTable(rows: ReturnType<typeof ranksByBracket>): string {
  const lines = ['| Tier | Rank | Weapon | Pierce | Score | vs turtle | vs bruiser | vs duelist | vs archer | vs knight |', '|---|---:|---|---|---:|---:|---:|---:|---:|---:|'];
  for (const r of rows) {
    lines.push(`| ${r.tier} | ${r.rank}/${r.of} | ${requireItem(r.weapon).name} | ${r.pierce} | ${f2(r.combined)} | ${Object.values(r.vs).map(pct).join(' | ')} |`);
  }
  return lines.join('\n');
}

function runsTable(s: RunBatchSummary[]): string {
  const lines = ['| Player strategy | Runs | Boss win rate | Boss wins round 1 | Pierce share of damage |', '|---|---:|---:|---:|---:|'];
  for (const r of s) lines.push(`| ${r.strategy} | ${r.runs} | ${pct(r.bossWinRate)} | ${pct(r.roundOneBossWinRate)} | ${pct(r.pierceDamageShare)} |`);
  return lines.join('\n');
}

function usageTable(u: ReturnType<typeof itemUsage>): string {
  const lines = ['| Item | Player rounds equipped | Boss rounds equipped |', '|---|---:|---:|'];
  for (const i of ITEMS) lines.push(`| ${i.name} | ${u.player[i.id] ?? 0} | ${u.boss[i.id] ?? 0} |`);
  return lines.join('\n');
}

function main() {
  const t0 = Date.now();
  fs.mkdirSync(OUT, { recursive: true });
  console.log(`[balance] fights/duel ${FIGHTS}, runs/strategy ${RUNS}`);

  const userRows = withItems(userOverrides, () => weaponMatrix(FIGHTS, 'balance'));
  const tunedRows = weaponMatrix(FIGHTS, 'balance');
  const userRanks = ranksByBracket(userRows);
  const tunedRanks = ranksByBracket(tunedRows);
  console.log(`[balance] matrices done (${Date.now() - t0} ms)`);

  const pierceIds = ITEMS.filter((i) => i.pierce).map((i) => i.id);
  const pierceSummary = pierceIds.map((id) => {
    const u = userRanks.find((r) => r.weapon === id)!;
    const t = tunedRanks.find((r) => r.weapon === id)!;
    return { weapon: id, tier: tierFor(requireItem(id)).name, user: { pierce: u.pierce, score: u.combined, rank: `${u.rank}/${u.of}` }, tuned: { pierce: t.pierce, score: t.combined, rank: `${t.rank}/${t.of}` } };
  });

  const userRuns = withItems(userOverrides, () => runAll(RUNS, 'user'));
  console.log(`[balance] runs (user pierce) done (${Date.now() - t0} ms)`);
  const tunedRuns = runAll(RUNS, 'tuned');
  console.log(`[balance] runs (tuned pierce) done (${Date.now() - t0} ms)`);

  const experiments = EXPERIMENTS.map((e) => {
    const rows = withItems(e.overrides, () => weaponMatrix(FIGHTS, 'balance'));
    const runs = withItems(e.overrides, () => runAll(Math.max(10, Math.round(RUNS / 2)), `exp:${e.name}`));
    console.log(`[balance] ${e.name} done (${Date.now() - t0} ms)`);
    return { ...e, ranks: ranksByBracket(rows), runs: runs.summary };
  });

  const report = { generatedAt: new Date().toISOString(), fights: FIGHTS, runsPerStrategy: RUNS, userRanks, tunedRanks, pierceSummary, userRuns, tunedRuns, experiments };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));

  const md = [
    `# Balance study output (${report.generatedAt})`,
    `Duels: ${FIGHTS} seeded fights each. Full runs: ${RUNS} per strategy, 10 rounds, real boss policy (baseline predictor).`,
    '## Pierce weapons: user values → tuned values',
    ['| Weapon | Tier | User pierce | Score | Rank in bracket | Tuned pierce | Score | Rank in bracket |', '|---|---|---|---:|---:|---|---:|---:|',
      ...pierceSummary.map((p) => `| ${requireItem(p.weapon).name} | ${p.tier} | ${p.user.pierce} | ${f2(p.user.score)} | ${p.user.rank} | ${p.tuned.pierce} | ${f2(p.tuned.score)} | ${p.tuned.rank} |`)].join('\n'),
    '## Weapon brackets (tuned values)', bracketTable(tunedRanks),
    '## Weapon brackets (user values)', bracketTable(userRanks),
    '## Full runs vs the boss — user pierce values', runsTable(userRuns.summary),
    '## Full runs vs the boss — tuned pierce values', runsTable(tunedRuns.summary),
    '## Item usage in full runs (tuned values)', usageTable(tunedRuns.usage),
    ...experiments.flatMap((e) => [`## Experiment: ${e.name}`, `Why: ${e.why}`, bracketTable(e.ranks), runsTable(e.runs)]),
  ].join('\n\n');
  fs.writeFileSync(path.join(OUT, 'report.md'), md);
  console.log(md);
  console.log(`[balance] wrote ${path.relative(REPO_ROOT, OUT)}/report.{json,md} in ${Date.now() - t0} ms`);
}

main();
