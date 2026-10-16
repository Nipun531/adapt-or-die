/**
 * DATASET STATISTICS + EXPORT (snapshot) of derived training_examples.
 *
 * Only rows of the current feature schema AND the current ENGINE_VERSION are used: rows produced under older
 * game rules (e.g. engine 1.0.0, before the 2 initial stat points) stay in the table as history but are never
 * mixed into new snapshots. Pass { engineVersion } to export a specific historical rule set explicitly.
 *
 * exportDataset() writes the VALID rows of that schema + engine version to
 *   artifacts/datasets/<schema>_<timestamp>.csv   (training input: provenance columns + label + baseline + features)
 *   artifacts/datasets/<schema>_<timestamp>.json  (same rows + metadata, for inspection / other tools)
 * and records a dataset_snapshots row (row counts, distributions, sha256 of the CSV) so every trained
 * model can be traced back to the exact data it saw. Invalid rows are counted but excluded.
 * Schema v2: RULE-DETERMINED rows (the player could not field a ranged weapon → label is 0 by the rules) are also
 * excluded and counted (`ruleDeterminedExcluded`): the boss never asks the model in that case, and including them
 * would inflate accuracy (they were 36% of the engine-1.1.0 snapshot). `player_strategy` is exported as provenance
 * (never a feature) so train.py can evaluate leave-one-strategy-out.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { env, REPO_ROOT } from '../config/env.js';
import type { Db } from '../db/pool.js';
import { ENGINE_VERSION } from '../game/constants.js';
import { FEATURE_NAMES, FEATURE_SCHEMA_VERSION, ML_TASK } from './features.js';

export interface DatasetStats {
  featureSchemaVersion: string;
  engineVersion: string;
  /** Row counts of the current schema per engine version (history included). */
  byEngine: { engine_version: string; valid: number; invalid: number; runs: number }[];
  total: number;
  valid: number;
  invalid: number;
  /** Valid rows where a ranged round was impossible (excluded from training/evaluation). */
  ruleDetermined: number;
  distinctRuns: number;
  labelDistribution: { ranged: number; melee: number };
  sourceDistribution: Record<string, number>;
  otherSchemaRows: number;
  otherEngineRows: number;
  rawRoundsCompleted: number;
  roundsMissingExamples: number;
}

export async function datasetStats(db: Db): Promise<DatasetStats> {
  const r = (await db.query(
    `SELECT count(*)::int AS total,
       count(*) FILTER (WHERE is_valid)::int AS valid,
       count(*) FILTER (WHERE NOT is_valid)::int AS invalid,
       count(*) FILTER (WHERE is_valid AND NOT COALESCE((label_detail->>'rangedFeasible')::boolean, true))::int AS rule_determined,
       count(DISTINCT run_id) FILTER (WHERE is_valid)::int AS runs,
       count(*) FILTER (WHERE is_valid AND label = 1)::int AS ranged,
       count(*) FILTER (WHERE is_valid AND label = 0)::int AS melee
     FROM training_examples WHERE feature_schema_version = $1 AND engine_version = $2`, [FEATURE_SCHEMA_VERSION, ENGINE_VERSION])).rows[0];
  const src = await db.query(
    `SELECT source, count(*)::int AS n FROM training_examples
     WHERE feature_schema_version = $1 AND engine_version = $2 AND is_valid GROUP BY source`,
    [FEATURE_SCHEMA_VERSION, ENGINE_VERSION]);
  const byEngine = (await db.query(
    `SELECT engine_version, count(*) FILTER (WHERE is_valid)::int AS valid, count(*) FILTER (WHERE NOT is_valid)::int AS invalid,
       count(DISTINCT run_id)::int AS runs
     FROM training_examples WHERE feature_schema_version = $1 GROUP BY engine_version ORDER BY engine_version`,
    [FEATURE_SCHEMA_VERSION])).rows;
  const other = (await db.query('SELECT count(*)::int AS n FROM training_examples WHERE feature_schema_version <> $1', [FEATURE_SCHEMA_VERSION])).rows[0];
  const raw = (await db.query(
    `SELECT count(*)::int AS rounds,
       count(*) FILTER (WHERE round_number >= 2 AND NOT EXISTS (
         SELECT 1 FROM training_examples t WHERE t.label_round_id = r.id AND t.feature_schema_version = $1))::int AS missing
     FROM rounds r JOIN runs u ON u.id = r.run_id WHERE r.status = 'completed' AND u.engine_version = $2`, [FEATURE_SCHEMA_VERSION, ENGINE_VERSION])).rows[0];
  return {
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    byEngine,
    total: r.total,
    valid: r.valid,
    invalid: r.invalid,
    ruleDetermined: r.rule_determined,
    distinctRuns: r.runs,
    labelDistribution: { ranged: r.ranged, melee: r.melee },
    sourceDistribution: Object.fromEntries(src.rows.map((x) => [x.source, x.n])),
    otherSchemaRows: other.n,
    otherEngineRows: byEngine.filter((e) => e.engine_version !== ENGINE_VERSION).reduce((a, e) => a + e.valid + e.invalid, 0),
    rawRoundsCompleted: raw.rounds,
    roundsMissingExamples: raw.missing,
  };
}

export interface SnapshotResult {
  snapshotId: number;
  engineVersion: string;
  csvPath: string;     // relative to repo root
  jsonPath: string;
  rowCount: number;
  invalidExcluded: number;
  ruleDeterminedExcluded: number;
  distinctRuns: number;
  sha256: string;
}

const PROVENANCE_COLS = ['example_id', 'run_id', 'feature_round_id', 'label_round_id', 'source', 'player_strategy', 'label', 'baseline_probability'] as const;

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function exportDataset(db: Db, opts: { engineVersion?: string } = {}): Promise<SnapshotResult> {
  const engineVersion = opts.engineVersion ?? ENGINE_VERSION;
  const rows = (await db.query(
    `SELECT t.id, t.run_id, t.feature_round_id, t.label_round_id, t.source, u.player_strategy, t.label, t.baseline_probability, t.features
     FROM training_examples t JOIN runs u ON u.id = t.run_id
     WHERE t.feature_schema_version = $1 AND t.engine_version = $2 AND t.is_valid AND COALESCE((t.label_detail->>'rangedFeasible')::boolean, true)
     ORDER BY t.id`,
    [FEATURE_SCHEMA_VERSION, engineVersion])).rows;
  const ruleExcluded = (await db.query(
    `SELECT count(*)::int AS n FROM training_examples WHERE feature_schema_version = $1 AND engine_version = $2 AND is_valid AND NOT COALESCE((label_detail->>'rangedFeasible')::boolean, true)`,
    [FEATURE_SCHEMA_VERSION, engineVersion])).rows[0].n;
  const invalid = (await db.query(
    'SELECT count(*)::int AS n FROM training_examples WHERE feature_schema_version = $1 AND engine_version = $2 AND NOT is_valid',
    [FEATURE_SCHEMA_VERSION, engineVersion])).rows[0].n;

  const dir = path.join(env.artifactsDir, 'datasets');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = `${FEATURE_SCHEMA_VERSION}_e${engineVersion}_${stamp}`;
  const csvAbs = path.join(dir, `${base}.csv`);
  const jsonAbs = path.join(dir, `${base}.json`);

  const header = [...PROVENANCE_COLS, ...FEATURE_NAMES];
  const lines = [header.join(',')];
  for (const r of rows) {
    const prov = [r.id, r.run_id, r.feature_round_id, r.label_round_id, r.source, r.player_strategy ?? (r.source === 'manual' ? 'manual' : ''), r.label, r.baseline_probability];
    lines.push([...prov, ...FEATURE_NAMES.map((f) => r.features[f])].map(csvCell).join(','));
  }
  const csv = lines.join('\n') + '\n';
  fs.writeFileSync(csvAbs, csv);
  const sha256 = crypto.createHash('sha256').update(csv).digest('hex');

  const label = { ranged: rows.filter((r) => r.label === 1).length, melee: rows.filter((r) => r.label === 0).length };
  const source: Record<string, number> = {};
  for (const r of rows) source[r.source] = (source[r.source] ?? 0) + 1;
  const distinctRuns = new Set(rows.map((r) => r.run_id)).size;
  fs.writeFileSync(jsonAbs, JSON.stringify({
    task: ML_TASK, featureSchemaVersion: FEATURE_SCHEMA_VERSION, engineVersion, featureNames: FEATURE_NAMES, csvSha256: sha256,
    rowCount: rows.length, invalidExcluded: invalid, ruleDeterminedExcluded: ruleExcluded, distinctRuns, labelDistribution: label, sourceDistribution: source,
    rows: rows.map((r) => ({ exampleId: r.id, runId: r.run_id, source: r.source, label: r.label, baselineProbability: r.baseline_probability, features: r.features })),
  }, null, 1));

  const rel = (p: string) => path.relative(REPO_ROOT, p).split(path.sep).join('/');
  const ins = await db.query(
    `INSERT INTO dataset_snapshots (feature_schema_version, engine_version, row_count, invalid_excluded, distinct_runs, label_distribution, source_distribution, file_path, sha256)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [FEATURE_SCHEMA_VERSION, engineVersion, rows.length, invalid, distinctRuns, JSON.stringify(label), JSON.stringify(source), rel(csvAbs), sha256],
  );
  return { snapshotId: ins.rows[0].id, engineVersion, csvPath: rel(csvAbs), jsonPath: rel(jsonAbs), rowCount: rows.length, invalidExcluded: invalid, ruleDeterminedExcluded: ruleExcluded, distinctRuns, sha256 };
}
