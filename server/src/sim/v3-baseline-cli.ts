/** CLI for the V2 control baseline (sim/v3-baseline.ts). Pure in-memory: no database access. */
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { POLICY_VERSION } from '../boss/policy.js';
import { REPO_ROOT } from '../config/env.js';
import { ENGINE_VERSION } from '../game/constants.js';
import { SIMULATOR_VERSION, STRATEGY_NAMES } from './agents.js';
import { MIRROR, playInMemoryRun } from './balance.js';
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

function gitSha(): string {
  try { return execSync('git rev-parse --short HEAD', { cwd: REPO_ROOT }).toString().trim(); } catch { return 'unknown'; }
}
const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '—');
const ci = (i: Interval) => `${pct(i.value)} [${pct(i.lo)}–${pct(i.hi)}]`;

function main() {
  const t0 = Date.now();
  const strategies = [...STRATEGY_NAMES, MIRROR];
  const reports: AgentReport[] = [];
  for (const s of strategies) {
    const results = Array.from({ length: RUNS }, (_, i) => playInMemoryRun(s, `${SEED}:${s}:${i}`, ROUNDS));
    reports.push(reportFor(s, results, SEED));
    process.stderr.write(`  ${s}: ${RUNS} runs (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`);
  }
  const mirrorR1 = mirrorRoundOne(MIRROR_R1, SEED);
  const results = { reports, mirrorR1 };
  const body = JSON.stringify(results);
  const out = {
    kind: 'v3-baseline (V2 control)',
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
  const file = path.join(OUT, `v3-baseline-${SEED}-${RUNS}x${ROUNDS}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));

  console.log(`V2 control baseline — engine ${ENGINE_VERSION}, policy ${POLICY_VERSION}, ${RUNS} runs × ${ROUNDS} rounds per agent, seed "${SEED}"`);
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
  console.log(`\nWrote ${path.relative(REPO_ROOT, file)} (results sha256 ${out.resultsSha256.slice(0, 16)}…, ${out.seconds.toFixed(0)}s)`);
}

main();
