/**
 * SIMULATION BATCH RUNNER.
 *
 * A batch plays `runs` complete runs, each with one agent strategy (round-robin over `strategies`), and
 * records everything through the normal services — so simulated rounds produce exactly the same raw
 * records (runs, rounds, combat_events, progression_events, boss_analyses, boss_decisions) and derived
 * training_examples as manual play, tagged source='simulation' with batch id, strategy, seed and
 * SIMULATOR_VERSION.
 *
 * Seeds form a tree:  batch seed → run seed "<batch>:run:<i>" → round combat seed / boss seed / agent seeds.
 * Re-running a batch with the same seed and settings reproduces the same fights PROVIDED the boss's
 * predictor is the same (same active model or fallback) — the predictor used is stored on each decision.
 * A re-run always creates NEW rows; existing history is never overwritten.
 *
 * Each round is its own transaction (like a manual round). If a run throws, its completed rounds are
 * kept, the run is marked 'failed' with the error, and the batch continues with the next run.
 */
import { getPool, withTransaction } from '../db/pool.js';
import { ENGINE_VERSION } from '../game/constants.js';
import { deriveSeed, Rng } from '../game/rng.js';
import { FEATURE_SCHEMA_VERSION } from '../ml/features.js';
import { startRound } from '../services/rounds.js';
import { autoStim } from '../game/combat.js';
import { LIVE_RULES } from '../game/rules.js';
import { autoSupplies, SIM_SAVINGS_RESERVE } from '../game/supply-plan.js';
import { AGENT_DEFENSE, defenseChooserFor } from './v3-policies.js';
import { allocate, buy, buySupplies, createRun, loadCombatant, setLoadout } from '../services/runs.js';
import { requireAgent, SIMULATOR_VERSION, STRATEGY_NAMES, type RoundOutcome } from './agents.js';

export interface BatchConfig {
  runs: number;
  maxRounds: number;
  strategies: string[];
  seed: string;
}

export interface BatchProgress {
  batchId: number;
  runsDone: number;
  runsRequested: number;
  failed: number;
  lastRun?: { runId: number; strategy: string; playerWins: number; bossWins: number };
}

export const BATCH_LIMITS = { maxRuns: 2000, maxRounds: 30 };

/** Validate + normalise user input (CLI and API share this). Throws with a readable message. */
export function normalizeConfig(input: Partial<BatchConfig>): BatchConfig {
  const runs = Number(input.runs ?? 20);
  const maxRounds = Number(input.maxRounds ?? 10);
  const strategies = input.strategies && input.strategies.length ? input.strategies : STRATEGY_NAMES;
  if (!Number.isInteger(runs) || runs < 1 || runs > BATCH_LIMITS.maxRuns) throw new Error(`runs must be an integer 1..${BATCH_LIMITS.maxRuns}`);
  if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > BATCH_LIMITS.maxRounds) {
    throw new Error(`maxRounds must be an integer 1..${BATCH_LIMITS.maxRounds}`);
  }
  strategies.forEach(requireAgent);
  const seed = String(input.seed ?? `batch-${Date.now().toString(36)}`).trim();
  if (!seed || seed.length > 100) throw new Error('seed must be 1..100 characters');
  return { runs, maxRounds, strategies, seed };
}

/** Insert the batch row (status 'queued'). Separate from execution so the API can return the id immediately. */
export async function createBatch(config: BatchConfig): Promise<number> {
  const r = await getPool().query(
    `INSERT INTO simulation_batches (seed, config, simulator_version, engine_version, runs_requested)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [config.seed, JSON.stringify(config), SIMULATOR_VERSION, ENGINE_VERSION, config.runs],
  );
  return r.rows[0].id;
}

/** Play one simulated run to completion. Returns its id. Throws (after marking the run failed) on error. */
export async function playSimulatedRun(opts: {
  batchId: number | null; strategy: string; runSeed: string; maxRounds: number;
}): Promise<number> {
  const agent = requireAgent(opts.strategy);
  const runId = await withTransaction((c) => createRun(c, {
    source: 'simulation', maxRounds: opts.maxRounds, seed: opts.runSeed, simulatorVersion: SIMULATOR_VERSION,
    simulationBatchId: opts.batchId, playerStrategy: agent.name, config: { strategy: agent.name },
  }));
  const history: RoundOutcome[] = [];
  try {
    for (let roundNumber = 1; roundNumber <= opts.maxRounds; roundNumber++) {
      await withTransaction(async (c) => {
        const state = await loadCombatant(c, runId, 'player');
        const decision = agent.decide({
          roundNumber, state, history: [...history], rng: new Rng(deriveSeed(opts.runSeed, `agent:${roundNumber}`)), runSeed: opts.runSeed,
        });
        for (const a of decision.allocations) await allocate(runId, a.stat, a.points, 'agent', c);
        for (const id of decision.purchases) await buy(runId, id, 'agent', c);
        await setLoadout(runId, decision.loadout, 'agent', c);
        // V3: leftover gold → healing stims (same heuristic as the boss), through the player's supply service.
        if (LIVE_RULES.v3) {
          for (const a of autoSupplies(await loadCombatant(c, runId, 'player'), SIM_SAVINGS_RESERVE).actions) await buySupplies(runId, a.action, 'agent', c);
        }
        const chooser = agent.chooser(new Rng(deriveSeed(opts.runSeed, `agent-choice:${roundNumber}`)));
        const roundId = await startRound(runId, {
          db: c,
          playerChooser: chooser,
          playerDefense: defenseChooserFor(AGENT_DEFENSE[agent.name] ?? 'smart', new Rng(deriveSeed(opts.runSeed, `agent-defense:${roundNumber}`)), LIVE_RULES),
          playerStim: autoStim,
        });
        const r = await c.query('SELECT status, winner, boss_snapshot, player_snapshot, player_hp_end FROM rounds WHERE id = $1', [roundId]);
        if (r.rows[0].status !== 'completed') throw new Error(`Round ${roundNumber} did not complete (agent chooser paused)`);
        const row = r.rows[0];
        history.push({
          roundNumber, winner: row.winner, bossLoadout: row.boss_snapshot.loadout,
          playerHpEndFrac: Math.max(0, row.player_hp_end) / row.player_snapshot.derived.maxHp,
        });
      });
    }
  } catch (err) {
    await getPool().query(
      `UPDATE runs SET status='failed', end_reason=$2, ended_at=now(), updated_at=now() WHERE id=$1 AND status='active'`,
      [runId, `error: ${(err as Error).message}`.slice(0, 500)],
    );
    throw Object.assign(err as Error, { runId });
  }
  return runId;
}

/** Execute a created batch. Resolves when every run has been attempted; progress is written to the DB after each run. */
export async function executeBatch(batchId: number, onProgress?: (p: BatchProgress) => void): Promise<void> {
  const pool = getPool();
  const row = (await pool.query('SELECT * FROM simulation_batches WHERE id = $1', [batchId])).rows[0];
  if (!row) throw new Error(`Simulation batch ${batchId} not found`);
  const config = row.config as BatchConfig;
  await pool.query(`UPDATE simulation_batches SET status='running', started_at=now() WHERE id=$1`, [batchId]);

  const errors: { runIndex: number; runId?: number; strategy: string; seed: string; message: string }[] = [];
  let done = 0;
  for (let i = 0; i < config.runs; i++) {
    const strategy = config.strategies[i % config.strategies.length];
    const runSeed = `${config.seed}:run:${i}`;
    let lastRun: BatchProgress['lastRun'];
    try {
      const runId = await playSimulatedRun({ batchId, strategy, runSeed, maxRounds: config.maxRounds });
      const w = (await pool.query(
        `SELECT count(*) FILTER (WHERE winner='player')::int AS p, count(*) FILTER (WHERE winner='boss')::int AS b FROM rounds WHERE run_id=$1`,
        [runId])).rows[0];
      lastRun = { runId, strategy, playerWins: w.p, bossWins: w.b };
    } catch (err) {
      const e = err as Error & { runId?: number };
      errors.push({ runIndex: i, runId: e.runId, strategy, seed: runSeed, message: e.message });
    }
    done++;
    await updateCounters(batchId, errors);
    onProgress?.({ batchId, runsDone: done, runsRequested: config.runs, failed: errors.length, lastRun });
  }
  const summary = await summarizeBatch(batchId);
  const status = errors.length === config.runs ? 'failed' : 'completed';
  await pool.query(
    `UPDATE simulation_batches SET status=$2, summary=$3, finished_at=now() WHERE id=$1`,
    [batchId, status, JSON.stringify(summary)],
  );
}

/** Recompute progress counters from the raw tables (robust: counters always match stored data). */
async function updateCounters(batchId: number, errors: unknown[]) {
  await getPool().query(
    `UPDATE simulation_batches b SET
       runs_completed = (SELECT count(*) FROM runs r WHERE r.simulation_batch_id = b.id AND r.status = 'completed'),
       runs_failed = $2,
       rounds_completed = (SELECT count(*) FROM rounds x JOIN runs r ON r.id = x.run_id
                           WHERE r.simulation_batch_id = b.id AND x.status = 'completed'),
       examples_created = (SELECT count(*) FROM training_examples t JOIN runs r ON r.id = t.run_id
                           WHERE r.simulation_batch_id = b.id AND t.feature_schema_version = $3),
       errors = $4
     WHERE b.id = $1`,
    [batchId, errors.length, FEATURE_SCHEMA_VERSION, JSON.stringify(errors)],
  );
}

/** Per-strategy outcome statistics for a batch. */
export async function summarizeBatch(batchId: number) {
  const r = await getPool().query(
    `SELECT r.player_strategy AS strategy,
       count(DISTINCT r.id)::int AS runs,
       count(x.id)::int AS rounds,
       count(x.id) FILTER (WHERE x.winner = 'player')::int AS player_wins,
       count(x.id) FILTER (WHERE x.winner = 'boss')::int AS boss_wins
     FROM runs r LEFT JOIN rounds x ON x.run_id = r.id AND x.status = 'completed'
     WHERE r.simulation_batch_id = $1 GROUP BY r.player_strategy ORDER BY r.player_strategy`,
    [batchId],
  );
  const byStrategy = r.rows.map((s) => ({ ...s, boss_win_rate: s.rounds ? s.boss_wins / s.rounds : null }));
  const totals = byStrategy.reduce(
    (a, s) => ({ runs: a.runs + s.runs, rounds: a.rounds + s.rounds, player_wins: a.player_wins + s.player_wins, boss_wins: a.boss_wins + s.boss_wins }),
    { runs: 0, rounds: 0, player_wins: 0, boss_wins: 0 },
  );
  const labels = (await getPool().query(
    `SELECT count(*) FILTER (WHERE t.label = 1)::int AS ranged, count(*) FILTER (WHERE t.label = 0)::int AS melee,
       count(*) FILTER (WHERE NOT t.is_valid)::int AS invalid
     FROM training_examples t JOIN runs r ON r.id = t.run_id WHERE r.simulation_batch_id = $1 AND t.feature_schema_version = $2`,
    [batchId, FEATURE_SCHEMA_VERSION])).rows[0];
  return {
    byStrategy,
    totals: { ...totals, boss_win_rate: totals.rounds ? totals.boss_wins / totals.rounds : null },
    labelDistribution: labels,
  };
}

/** Batch rows for the API/UI (newest first). */
export async function listBatches(limit = 25) {
  const r = await getPool().query('SELECT * FROM simulation_batches ORDER BY id DESC LIMIT $1', [Math.min(Math.max(limit, 1), 200)]);
  return r.rows;
}

export async function getBatch(batchId: number) {
  return (await getPool().query('SELECT * FROM simulation_batches WHERE id = $1', [batchId])).rows[0] ?? null;
}

/**
 * Batches marked running/queued when the server starts were interrupted (process exit). Mark them failed
 * so the UI never shows a batch as running forever. Completed runs inside them are kept.
 * A batch with run activity in the last 5 minutes is left alone (it may be a CLI batch still running).
 */
export async function markInterruptedBatches(): Promise<number> {
  const r = await getPool().query(
    `UPDATE simulation_batches b SET status='failed', finished_at=now(),
       errors = errors || '[{"message":"Interrupted: process stopped while the batch was running"}]'::jsonb
     WHERE status IN ('queued','running')
       AND COALESCE(b.started_at, b.created_at) < now() - interval '5 minutes'
       AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.simulation_batch_id = b.id AND r.updated_at > now() - interval '5 minutes')`,
  );
  return r.rowCount ?? 0;
}
