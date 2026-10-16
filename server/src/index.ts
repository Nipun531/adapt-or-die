/**
 * Server entry point (`npm run dev:server` / `npm start`).
 * Checks the database connection first so a misconfigured .env fails fast with an actionable message,
 * marks simulation batches interrupted by a previous shutdown as failed, then starts the HTTP API.
 */
import { createApp } from './api/app.js';
import { currentDatabaseDescription, explainDbError, getPool } from './db/pool.js';
import { env } from './config/env.js';
import { stopInferenceWorker } from './ml/predictor.js';
import { markInterruptedBatches } from './sim/runner.js';

async function main() {
  try {
    await getPool().query('SELECT 1 FROM runs LIMIT 1');
  } catch (err) {
    console.error(`[server] database check failed: ${explainDbError(err)}`);
    process.exit(1);
  }
  const interrupted = await markInterruptedBatches();
  if (interrupted) console.log(`[server] marked ${interrupted} interrupted simulation batch(es) as failed`);
  const app = createApp();
  app.listen(env.port, () => {
    console.log(`[server] The Boss Remembers API on http://localhost:${env.port} (db ${currentDatabaseDescription()})`);
  });
}

process.on('SIGINT', () => {
  stopInferenceWorker();
  process.exit(0);
});

main();
