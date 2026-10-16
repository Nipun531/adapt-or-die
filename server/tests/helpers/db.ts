/**
 * Test helper: points the app at TEST_DATABASE_URL, runs migrations once, and wipes all tables between tests.
 * Requires the Docker Postgres from docker-compose.yml (`npm run db:up`).
 */
import { env } from '../../src/config/env.js';
import { migrate } from '../../src/db/migrate.js';
import { getPool, setDatabaseUrl, withTransaction } from '../../src/db/pool.js';
import { INITIAL_STAT_POINTS } from '../../src/game/constants.js';
import type { StatKey } from '../../src/game/types.js';
import { allocate, createRun, type CreateRunOptions } from '../../src/services/runs.js';

let migrated = false;

export async function useTestDatabase(): Promise<void> {
  if (!env.testDatabaseUrl) throw new Error('TEST_DATABASE_URL is not set in .env');
  if (env.testDatabaseUrl === env.databaseUrl) throw new Error('TEST_DATABASE_URL must differ from DATABASE_URL (tests wipe data)');
  if (!migrated) {
    await migrate(env.testDatabaseUrl, false);
    migrated = true;
  }
  await setDatabaseUrl(env.testDatabaseUrl);
}

export async function resetTables(): Promise<void> {
  await getPool().query(`TRUNCATE runs, combatants, rounds, combat_events, progression_events, boss_analyses, boss_decisions,
    simulation_batches, training_examples, dataset_snapshots, model_versions RESTART IDENTITY CASCADE`);
}

/**
 * Create a manual run (in a transaction, like the API) and spend the player's 2 initial stat points (engine 1.1.0),
 * so round 1 can start. Points go to `stat` (default STR); the boss spends its own points in round-1 preparation.
 */
export async function createReadyRun(opts: CreateRunOptions = {}, stat: StatKey = 'str'): Promise<number> {
  const runId = await withTransaction((c) => createRun(c, opts));
  await allocate(runId, stat, INITIAL_STAT_POINTS);
  return runId;
}
