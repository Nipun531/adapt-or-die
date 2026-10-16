/**
 * Simulation CLI:  npm run sim -- --runs 50 --rounds 10 --strategies archer,melee_bruiser --seed my-seed
 *
 * Options (all optional):
 *   --runs <n>            runs to play (default 20, max 2000)
 *   --rounds <n>          max rounds per run (default 10, max 30)
 *   --strategies <a,b>    comma-separated agent names (default: all) — see src/sim/agents.ts
 *   --seed <text>         batch seed (default: time-based). Same seed + settings + predictor → same fights.
 *   --list                print available strategies and exit
 * Progress is printed per run; the batch row in simulation_batches holds counters, summary and errors.
 */
import { closePool, explainDbError } from '../db/pool.js';
import { stopInferenceWorker } from '../ml/predictor.js';
import { AGENTS } from './agents.js';
import { createBatch, executeBatch, getBatch, normalizeConfig } from './runner.js';

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = 'true';
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    for (const a of Object.values(AGENTS)) console.log(`${a.name.padEnd(14)} ${a.description}`);
    return;
  }
  const config = normalizeConfig({
    runs: args.runs ? Number(args.runs) : undefined,
    maxRounds: args.rounds ? Number(args.rounds) : undefined,
    strategies: args.strategies ? args.strategies.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    seed: args.seed,
  });
  const batchId = await createBatch(config);
  console.log(`[sim] batch ${batchId}: ${config.runs} run(s) × ≤${config.maxRounds} rounds, strategies=${config.strategies.join(',')}, seed="${config.seed}"`);
  const t0 = Date.now();
  await executeBatch(batchId, (p) => {
    const tail = p.lastRun
      ? `run ${p.lastRun.runId} ${p.lastRun.strategy}: player ${p.lastRun.playerWins} – boss ${p.lastRun.bossWins}`
      : 'run FAILED';
    console.log(`[sim] ${p.runsDone}/${p.runsRequested} (${p.failed} failed) ${tail}`);
  });
  const b = await getBatch(batchId);
  console.log(`[sim] batch ${batchId} ${b.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s — runs ok ${b.runs_completed}, failed ${b.runs_failed}, rounds ${b.rounds_completed}, training examples ${b.examples_created}`);
  for (const s of b.summary.byStrategy ?? []) {
    console.log(`       ${String(s.strategy).padEnd(14)} runs ${s.runs}  rounds ${s.rounds}  player wins ${s.player_wins}  boss wins ${s.boss_wins}  boss win rate ${s.boss_win_rate === null ? '—' : (s.boss_win_rate * 100).toFixed(1) + '%'}`);
  }
  for (const e of (b.errors ?? []).slice(0, 5)) console.log(`       error run#${e.runIndex} (${e.strategy}, seed ${e.seed}): ${e.message}`);
}

main()
  .catch((err) => {
    console.error(`[sim] ${explainDbError(err)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    stopInferenceWorker();
    await closePool();
  });
