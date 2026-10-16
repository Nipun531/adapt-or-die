/**
 * DERIVED TRAINING EXAMPLES.
 * One row per (run, label round N+1 ≥ 2): features from rounds 1..N, label from round N+1.
 * Rows are appended (ON CONFLICT DO NOTHING) — never overwritten. Changing features means bumping
 * FEATURE_SCHEMA_VERSION; old-version rows stay for comparison and new rows are rebuilt from raw records.
 */
import type { Db } from '../db/pool.js';
import { loadCompletedRounds } from '../services/history.js';
import { baselineProbability, buildFeatures, FEATURE_SCHEMA_VERSION, isMostlyRanged } from './features.js';

/** Append the example whose label comes from `labelRoundNumber`. Returns 1 if inserted, 0 otherwise. */
export async function appendExample(db: Db, runId: number, labelRoundNumber: number): Promise<number> {
  if (labelRoundNumber < 2) return 0;
  const rows = await loadCompletedRounds(db, runId, labelRoundNumber);
  const labelRow = rows.find((r) => r.record.roundNumber === labelRoundNumber);
  const prior = rows.filter((r) => r.record.roundNumber < labelRoundNumber);
  if (!labelRow || prior.length === 0) return 0;
  const history = prior.map((r) => r.record); // ← rounds 1..N only: the leakage boundary
  const features = buildFeatures(history);
  const label = isMostlyRanged(labelRow.record.summary);
  const run = (await db.query('SELECT source, engine_version, simulator_version, seed FROM runs WHERE id = $1', [runId])).rows[0];
  const valid = label !== null;
  const res = await db.query(
    `INSERT INTO training_examples (run_id, feature_round_id, label_round_id, feature_schema_version, source, engine_version,
       simulator_version, seed, features, label, label_detail, baseline_probability, is_valid, invalid_reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (label_round_id, feature_schema_version) DO NOTHING`,
    [runId, prior[prior.length - 1].id, labelRow.id, FEATURE_SCHEMA_VERSION, run.source, run.engine_version,
      run.simulator_version, run.seed, JSON.stringify(features), valid ? (label ? 1 : 0) : null,
      JSON.stringify({ rangedShare: labelRow.record.summary.player.rangedShare, attacks: labelRow.record.summary.player.attacks }),
      baselineProbability(history), valid, valid ? null : 'Player made no attacks in the label round'],
  );
  return res.rowCount ?? 0;
}

/** Build any missing examples for the current schema from raw records (safe to re-run). */
export async function buildMissingExamples(db: Db): Promise<{ inserted: number; scanned: number }> {
  const missing = await db.query(
    `SELECT r.run_id, r.round_number FROM rounds r
     WHERE r.status = 'completed' AND r.round_number >= 2
       AND NOT EXISTS (SELECT 1 FROM training_examples t WHERE t.label_round_id = r.id AND t.feature_schema_version = $1)
     ORDER BY r.run_id, r.round_number`, [FEATURE_SCHEMA_VERSION]);
  let inserted = 0;
  for (const row of missing.rows) inserted += await appendExample(db, row.run_id, row.round_number);
  return { inserted, scanned: missing.rowCount ?? 0 };
}
