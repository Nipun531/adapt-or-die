/**
 * `npm run db:check` — verifies the database connection and schema, printing table row counts.
 * Prints the connection string with the password masked.
 */
import { closePool, currentDatabaseDescription, explainDbError, getPool } from './pool.js';

const TABLES = [
  'runs', 'combatants', 'rounds', 'combat_events', 'progression_events', 'boss_analyses',
  'boss_decisions', 'simulation_batches', 'training_examples', 'dataset_snapshots', 'model_versions',
];

async function main() {
  console.log(`Checking ${currentDatabaseDescription()}`);
  try {
    const v = await getPool().query('SELECT version()');
    console.log(`Connected: ${v.rows[0].version.split(',')[0]}`);
    for (const t of TABLES) {
      const r = await getPool().query(`SELECT count(*)::int AS n FROM ${t}`);
      console.log(`  ${t.padEnd(20)} ${r.rows[0].n}`);
    }
    console.log('OK');
  } catch (err) {
    console.error(`FAILED: ${explainDbError(err)}`);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}
main();
