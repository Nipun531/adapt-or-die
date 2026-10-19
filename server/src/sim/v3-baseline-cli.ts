/**
 * CLI for the control baseline (sim/v3-baseline.ts). Pure in-memory: no database access.
 *   npm run v3:baseline                                  V2 control (engine 2.0.0 rules)
 *   npm run v3:baseline -- --rules v3                    same seeds under RuleSet v3 (paired)
 *   npm run v3:baseline -- --rules v3 --ablate turnOrder one DEX benefit switched off (mitigation|bonusAttacks|turnOrder|firstShot)
 *   … --agents a,b,mirror   subset;   --compare <json>   paired difference table against another baseline JSON
 */
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { POLICY_VERSION } from '../boss/policy.js';
import { REPO_ROOT } from '../config/env.js';
import { ENGINE_VERSION } from '../game/constants.js';
import { SIMULATOR_VERSION, STRATEGY_NAMES } from './agents.js';
import { MIRROR, playInMemoryRun } from './balance.js';
import { RULES_V2, RULES_V3, withRules, type DexBenefits, type RuleSet } from '../game/rules.js';
import { BOOT, mirrorRoundOne, reportFor, type AgentReport, type Interval } from './v3-baseline.js';

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};
const RUNS = Number(arg('runs', '100'));
const ROUNDS = Number(arg('rounds', '10'));
const SEED = arg('seed', 'v3-baseline');
const MIRROR_R1 = Number(arg('mirror-r1', '2000'));
const OUT = path.resolve(REPO_ROOT, arg('out', 'artifacts/balance'));
const RULES_ID = arg('rules', 'v2');
const ABLATE = arg('ablate', '') as keyof DexBenefits | '';
const AGENTS = arg('agents', '');
const COMPARE = arg('compare', '');
let RULES: RuleSet = RULES_ID === 'v3' ? RULES_V3 : RULES_V2;
if (ABLATE) RULES = withRules(RULES, { dexBenefits: { [ABLATE]: false } });
const TAG = RULES_ID === 'v2' && !ABLATE ? '' : `-${RULES_ID}${ABLATE ? `-no-${ABLATE}` : ''}`;

function gitSha(): string {
  try { return execSync('git rev-parse --short HEAD', { cwd: REPO_ROOT }).toString().trim(); } catch { return 'unknown'; }
}
const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '—');
const ci = (i: Interval) => `${pct(i.value)} [${pct(i.lo)}–${pct(i.hi)}]`;

function main() {
  const t0 = Date.now();
  const strategies = AGENTS ? AGENTS.split(',') : [...STRATEGY_NAMES, MIRROR];
  const reports: AgentReport[] = [];
  for (const s of strategies) {
    const results = Array.from({ length: RUNS }, (_, i) => playInMemoryRun(s, `${SEED}:${s}:${i}`, ROUNDS, { rules: RULES }));
    reports.push(reportFor(s, results, SEED));
    process.stderr.write(`  ${s}: ${RUNS} runs (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`);
  }
  const mirrorR1 = mirrorRoundOne(MIRROR_R1, SEED, { rules: RULES });
  const results = { reports, mirrorR1 };
  const body = JSON.stringify(results);
  const out = {
    kind: RULES_ID === 'v2' && !ABLATE ? 'v3-baseline (V2 control)' : `v3-baseline (rules ${RULES_ID}${ABLATE ? `, ${ABLATE} off` : ''})`,
    rules: RULES,
    createdAt: new Date().toISOString(),
    git: gitSha(),
    engineVersion: ENGINE_VERSION,
    policyVersion: POLICY_VERSION,
    simulatorVersion: SIMULATOR_VERSION,
    predictor: 'baseline',
    config: { runs: RUNS, rounds: ROUNDS, seed: SEED, seedPattern: `${SEED}:<strategy>:<i>`, mirrorR1: MIRROR_R1, mirrorR1Pattern: `${SEED}:mirror-r1:<i>`, bootstrap: BOOT },
    resultsSha256: crypto.createHash('sha256').update(body).digest('hex'),
    seconds: (Date.now() - t0) / 1000,
    ...results,
  };
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `v3-baseline-${SEED}-${RUNS}x${ROUNDS}${TAG}${AGENTS ? '-subset' : ''}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));

  console.log(`${out.kind} — engine ${ENGINE_VERSION}, policy ${POLICY_VERSION}, ${RUNS} runs × ${ROUNDS} rounds per agent, seed "${SEED}"`);
  console.log('| Agent | Boss win (95% CI) | Round 1 | r1-2 | r3-5 | r6-10 | Boss comeback | Player comeback | R1 winner wins run |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const r of reports) {
    console.log(`| ${r.strategy} | ${ci(r.bossWin)} | ${ci(r.roundOneBossWin)} | ${pct(r.stages['r1-2'].bossWin.value)} | ${pct(r.stages['r3-5'].bossWin.value)} | ${pct(r.stages['r6-10'].bossWin.value)} | ${ci(r.bossComeback)} | ${ci(r.playerComeback)} | ${pct(r.runWinnerFromRoundOne.value)} |`);
  }
  console.log('\n| Agent | Stage | Attacks/round | Boss DEX lead (median) | Boss top build (share) | Build entropy (bits) | Pierce dmg share |');
  console.log('|---|---|---|---|---|---|---|');
  for (const r of reports) for (const [k, s] of Object.entries(r.stages)) {
    console.log(`| ${r.strategy} | ${k} | ${s.attacksPerRound.toFixed(1)} | ${s.dexLeadBossMedian.toFixed(1)} | ${s.bossTopBuild.build} (${pct(s.bossTopBuild.share)}) | ${s.bossBuildEntropy.toFixed(2)} | ${pct(s.pierceDamageShare)} |`);
  }
  console.log(`\nMirror round 1 (${mirrorR1.n} seeds): boss win ${ci(mirrorR1.bossWin)}; DEX-tie rounds ${mirrorR1.dexTieRounds}; ` +
    `tie first mover wins ${ci(mirrorR1.tieFirstMoverWins)}; faster side ${JSON.stringify(mirrorR1.fasterSide)} wins ${ci(mirrorR1.fasterSideWins)}`);
  if (COMPARE) {
    const other = JSON.parse(fs.readFileSync(path.resolve(REPO_ROOT, COMPARE), 'utf8')) as { kind: string; reports: AgentReport[] };
    const late = (r: AgentReport) => {
      const a = r.stages['r6-10'].bossArchetypes;
      const tot = Object.values(a).reduce((x, y) => x + y, 0);
      const top = Object.entries(a).sort((x, y) => y[1] - x[1])[0];
      return top ? `${top[0]} ${pct(top[1] / tot)}` : '—';
    };
    const d = (a: number, b: number) => ((a - b) * 100).toFixed(1);
    console.log(`\nPaired difference vs ${other.kind} (same seeds): this − other, percentage points`);
    console.log('| Agent | Boss win: other → this (Δ) | Round 1 Δ | r6-10 Δ | Player comeback: other → this | R1 winner wins run: other → this | Boss late archetype: other → this | Late HP margin: other → this |');
    console.log('|---|---|---|---|---|---|---|---|');
    for (const r of reports) {
      const o = other.reports.find((x) => x.strategy === r.strategy);
      if (!o) continue;
      console.log(`| ${r.strategy} | ${pct(o.bossWin.value)} → ${pct(r.bossWin.value)} (${d(r.bossWin.value, o.bossWin.value)}) | ${d(r.roundOneBossWin.value, o.roundOneBossWin.value)} | ${d(r.stages['r6-10'].bossWin.value, o.stages['r6-10'].bossWin.value)} | ${pct(o.playerComeback.value)} → ${pct(r.playerComeback.value)} | ${pct(o.runWinnerFromRoundOne.value)} → ${pct(r.runWinnerFromRoundOne.value)} | ${late(o)} → ${late(r)} | ${o.stages['r6-10'].bossMargin.value.toFixed(2)} → ${r.stages['r6-10'].bossMargin.value.toFixed(2)} |`);
    }
  }
  console.log(`\nWrote ${path.relative(REPO_ROOT, file)} (results sha256 ${out.resultsSha256.slice(0, 16)}…, ${out.seconds.toFixed(0)}s)`);
}

main();
