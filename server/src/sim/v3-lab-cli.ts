/**
 * V3 mechanics lab CLI (sim/v3-lab.ts). Pure in-memory, no database.
 *
 *   npm run v3:lab -- sweep   [--builds 800] [--fights 10000] [--seed lab]   dodge sweep, then stun sweep, then joint grid
 *   npm run v3:lab -- confirm [--builds 1500] [--fights 30000] [--seed lab-confirm]   V2 vs V3-default vs top candidates
 *
 * Writes artifacts/balance/v3-lab-<cmd>-<seed>.{json,md}. The targets ("sweet spot") are defined in TARGETS below
 * and documented in docs/V3_BALANCE.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../config/env.js';
import { RULES_V2, RULES_V3, withRules, type RuleSet, type V3Combat } from '../game/rules.js';
import { LAB_STAGES, makePopulation, runLab, type LabMetrics, type LabPopulation } from './v3-lab.js';

const cmd = process.argv[2] ?? 'sweep';
const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};
const BUILDS = Number(arg('builds', cmd === 'confirm' ? '1500' : '800'));
const FIGHTS = Number(arg('fights', cmd === 'confirm' ? '30000' : '10000'));
const SEED = arg('seed', cmd === 'confirm' ? 'lab-confirm' : 'lab');
const OUT = path.resolve(REPO_ROOT, arg('out', 'artifacts/balance'));

type Patch = { [K in keyof V3Combat]?: Partial<V3Combat[K]> };
interface Variant { name: string; patch: Patch }

// ---------- sweet-spot targets (proposed; owner approves in docs/V3_BALANCE.md) ----------
export interface Scored { name: string; patch: Patch; score: number; misses: string[]; byStage: Record<string, LabMetrics> }

/** Penalty = weight × (percentage points outside the band) / 5 — every 5 pp off target costs 1 point. */
const range = (v: number, lo: number, hi: number, label: string, misses: string[], weight = 1): number => {
  if (!Number.isFinite(v)) return 0;
  if (v < lo) { misses.push(`${label} ${(v * 100).toFixed(1)} < ${(lo * 100).toFixed(0)}`); return (weight * (lo - v) * 100) / 5; }
  if (v > hi) { misses.push(`${label} ${(v * 100).toFixed(1)} > ${(hi * 100).toFixed(0)}`); return (weight * (v - hi) * 100) / 5; }
  return 0;
};

/**
 * Score = Σ relative distance outside each target band (0 = every target met). Stun targets use mid + late
 * (no can-stun weapon is affordable in round 1); dodge and fairness targets use all stages.
 */
function score(byStage: Record<string, LabMetrics>, v2: Record<string, LabMetrics>): { score: number; misses: string[] } {
  const misses: string[] = [];
  let s = 0;
  for (const [st, m] of Object.entries(byStage)) {
    const tag = (x: string) => `${st} ${x}`;
    const g = m.groups;
    // Dodge: a real option at every stage, not a trap and not a must-pick.
    s += range(m.dodgeRate.value, 0.2, 0.45, tag('dodge success'), misses);
    if (st !== 'early') s += range(m.smartDodgeShare, 0.3, 0.65, tag('smart players dodge share'), misses);
    s += range(Math.abs(g['style:dodge'].value - g['style:block'].value), 0, 0.05, tag('|dodge style − block style|'), misses);
    // DEX must not get more dominant than in V2 (1 pp tolerance)
    s += range(m.fasterWins.value - v2[st].fasterWins.value, -1, 0.01, tag('faster-wins vs V2'), misses, 2);
    // Pace / safety
    s += range(m.attacksPerFight / 20, 0, 1, tag('attacks per fight /20'), misses, 0.2);
    if (m.stalls) { s += 5; misses.push(tag(`${m.stalls} stalls`)); }
    if (st === 'early') continue;
    // Stun
    s += range(m.stunHolderLandsStun.value, 0.3, 0.55, tag('stun holder lands a stun'), misses);
    s += range(m.stunExtraDamageShare, 0.01, 0.06, tag('stun extra-damage share'), misses, 0.5);
    s += range(m.stunChainShare.value, 0, 0.05, tag('stun chains'), misses, 2);
    // (The "stunner wins when it lands a stun" rate is reported but NOT scored: it is selection-biased — landing a stun
    // needs many landed hits. The paired stun-on/off effect in `confirm` is the causal measure.)
    // Stun gear must not become dominant: its win-rate change vs V2 ≤ +5 pp
    s += range(g['gear:can-stun weapon'].value - v2[st].groups['gear:can-stun weapon'].value, -1, 0.05, tag('can-stun gear vs V2'), misses);
  }
  return { score: s, misses };
}

// ---------- variants ----------
const DODGE: Variant[] = [];
for (const delta of ['points', 'signed'] as const) for (const base of [0.05, 0.1, 0.15, 0.2, 0.25]) for (const perDexPoint of [0.01, 0.02, 0.03]) {
  DODGE.push({ name: `dodge ${delta} base ${base} per ${perDexPoint}`, patch: { dodge: { base, perDexPoint, delta } } });
}
const stunVariants = (dodge: Patch['dodge']): Variant[] => {
  const out: Variant[] = [];
  for (const k of [1.5, 1.75, 2, 2.25, 2.5]) for (const extraDamageFraction of [0.25, 0.5, 0.75]) for (const boostScale of [1, 3]) {
    out.push({
      name: `stun ×${k} extra ${extraDamageFraction} boost×${boostScale}`,
      patch: { dodge, stun: { base: 10 * k, span: 10 * k, extraDamageFraction, boostScale, sumCap: boostScale > 1 ? 1.5 : 1 } },
    });
  }
  return out;
};

function evaluate(pops: LabPopulation[], rules: RuleSet): Record<string, LabMetrics> {
  return Object.fromEntries(pops.map((p) => [p.stage.name, runLab(p, rules)]));
}

const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '—');
function row(name: string, by: Record<string, LabMetrics>, sc?: number): string {
  const m = by.mid, l = by.late, e = by.early;
  const st = (x: LabMetrics) => `${pct(x.stunHolderLandsStun.value)} / ${pct(x.stunExtraDamageShare)} / ${pct(x.stunChainShare.value)} / ${pct(x.stunnerWinWhenLanded.value)} vs ${pct(x.stunnerWinWhenNot.value)}`;
  const dg = (x: LabMetrics) => `${pct(x.dodgeRate.value)} / ${pct(x.smartDodgeShare)} / ${pct(x.groups['style:dodge'].value)} vs ${pct(x.groups['style:block'].value)}`;
  return `| ${name} | ${sc === undefined ? '—' : sc.toFixed(2)} | ${dg(e)} | ${dg(m)} | ${dg(l)} | ${st(m)} | ${st(l)} | ${pct(e.fasterWins.value)} / ${pct(m.fasterWins.value)} / ${pct(l.fasterWins.value)} | ${e.attacksPerFight.toFixed(1)} / ${m.attacksPerFight.toFixed(1)} / ${l.attacksPerFight.toFixed(1)} |`;
}
const HEADER = '| Variant | Score (0 = all targets met) | Early dodge: success / smart dodge share / dodge-style vs block-style win | Mid dodge | Late dodge | Mid stun: holder lands ≥1 / extra-dmg share / chains / holder win landed vs not | Late stun | Faster fighter wins (E/M/L) | Attacks per fight (E/M/L) |\n|---|---|---|---|---|---|---|---|---|';

function main() {
  const t0 = Date.now();
  const pops = LAB_STAGES.map((st) => makePopulation(st, BUILDS, FIGHTS, SEED));
  const v2 = evaluate(pops, RULES_V2);
  const v3 = evaluate(pops, RULES_V3);
  const lines: string[] = [`# V3 lab — ${cmd} (seed "${SEED}", ${BUILDS} builds × ${FIGHTS} fights per stage)`, ''];
  const all: Scored[] = [];
  const scoreOf = (name: string, patch: Patch): Scored => {
    const by = evaluate(pops, withRules(RULES_V3, { v3: patch }));
    const { score: sc, misses } = score(by, v2);
    const s = { name, patch, score: sc, misses, byStage: by };
    all.push(s);
    return s;
  };

  if (cmd === 'sweep') {
    const base = scoreOf('V3 default (tuned sweet spot)', {});
    lines.push('## 1. Dodge sweep (stun at default)', '', HEADER, row('V2 (control)', v2), row(base.name, base.byStage, base.score));
    const dodge = DODGE.map((v) => scoreOf(v.name, v.patch)).sort((a, b) => a.score - b.score);
    for (const d of dodge) lines.push(row(d.name, d.byStage, d.score));
    const bestDodge = dodge.slice(0, 4);
    process.stderr.write(`dodge sweep done (${((Date.now() - t0) / 1000).toFixed(0)}s); best: ${bestDodge.map((d) => d.name).join('; ')}\n`);

    lines.push('', '## 2. Stun sweep on the 4 best dodge settings', '', HEADER);
    const stun = bestDodge.flatMap((d) => stunVariants(d.patch.dodge).map((v) => scoreOf(`${d.name} + ${v.name}`, v.patch))).sort((a, b) => a.score - b.score);
    for (const s of stun.slice(0, 25)) lines.push(row(s.name, s.byStage, s.score));
    lines.push('', '## 3. Best 5 overall — targets missed', '');
    for (const s of [...all].sort((a, b) => a.score - b.score).slice(0, 5)) lines.push(`- **${s.name}** (score ${s.score.toFixed(2)}): ${s.misses.length ? s.misses.join('; ') : 'all targets met'}`);
  } else if (cmd === 'confirm') {
    const cands: Variant[] = JSON.parse(fs.readFileSync(path.resolve(REPO_ROOT, arg('candidates', 'docs/v3-lab/candidates.json')), 'utf8'));
    const base = scoreOf('V3 default (tuned sweet spot)', {});
    lines.push(HEADER, row('V2 (control)', v2), row(base.name, base.byStage, base.score));
    for (const c of cands) { const s = scoreOf(c.name, c.patch); lines.push(row(s.name, s.byStage, s.score)); }
    // Paired causal effects on identical fights.
    lines.push('', '### What stun changes (paired: same fights with stun triggering off)', '',
      '| Variant | Stage | Can-stun holder win: stun on | stun off | Δ (pp) | Stuns per fight | Lost turns per fight |', '|---|---|---|---|---|---|---|');
    for (const s of all) {
      const off = evaluate(pops, withRules(RULES_V3, { v3: { ...s.patch, stun: { ...(s.patch.stun ?? {}), trigger: false } } }));
      for (const st of ['mid', 'late']) {
        const on = s.byStage[st].groups['gear:can-stun weapon'], o = off[st].groups['gear:can-stun weapon'];
        lines.push(`| ${s.name} | ${st} | ${pct(on.value)} | ${pct(o.value)} | ${((on.value - o.value) * 100).toFixed(1)} | ${s.byStage[st].stunsPerFight.toFixed(2)} | ${s.byStage[st].skipsPerFight.toFixed(2)} |`);
      }
    }
    lines.push('', '### What the dodge change does (paired vs V3 default)', '',
      '| Variant | Stage | Dodge-style win | Block-style win | Smart-style win | Dodge success | Δ dodge-style vs default (pp) |', '|---|---|---|---|---|---|---|');
    for (const s of all) for (const st of ['early', 'mid', 'late']) {
      const g = s.byStage[st].groups;
      lines.push(`| ${s.name} | ${st} | ${pct(g['style:dodge'].value)} | ${pct(g['style:block'].value)} | ${pct(g['style:smart'].value)} | ${pct(s.byStage[st].dodgeRate.value)} | ${((g['style:dodge'].value - base.byStage[st].groups['style:dodge'].value) * 100).toFixed(1)} |`);
    }
    lines.push('', '### Targets missed', '');
    for (const s of all) lines.push(`- **${s.name}** (score ${s.score.toFixed(2)}): ${s.misses.length ? s.misses.join('; ') : 'all targets met'}`);
    lines.push('', '### Win rate by group (late stage), V2 → candidates', '');
    const keys = Object.keys(v2.late.groups);
    lines.push(`| Group | V2 | ${all.map((s) => s.name).join(' | ')} |`, `|---|---|${all.map(() => '---').join('|')}|`);
    for (const k of keys) lines.push(`| ${k} | ${pct(v2.late.groups[k].value)} | ${all.map((s) => pct(s.byStage.late.groups[k]?.value ?? NaN)).join(' | ')} |`);
  }
  void v3;
  fs.mkdirSync(OUT, { recursive: true });
  const base = path.join(OUT, `v3-lab-${cmd}-${SEED}`);
  fs.writeFileSync(`${base}.md`, lines.join('\n') + '\n');
  fs.writeFileSync(`${base}.json`, JSON.stringify({ cmd, seed: SEED, builds: BUILDS, fights: FIGHTS, v2, results: all.map(({ name, patch, score: sc, misses, byStage }) => ({ name, patch, score: sc, misses, byStage })) }, null, 1));
  console.log(lines.join('\n'));
  console.error(`wrote ${path.relative(REPO_ROOT, base)}.{md,json} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

main();
