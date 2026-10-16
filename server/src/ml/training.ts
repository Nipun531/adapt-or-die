/**
 * ML ORCHESTRATION: build dataset → export snapshot → train/evaluate (Python) → record model version →
 * (optionally) activate. Also model listing/activation and the status report shown in the UI/CLI.
 *
 * Training is ALWAYS an explicit action (CLI `npm run ml:train` or the ML Lab button). New data never
 * changes the active model by itself. Activation is refused for models that failed the eligibility rule
 * in ml/train.py or were trained on data from a different ENGINE_VERSION (older game rules), and every boss
 * decision records whether the model or the fallback was used.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { env, REPO_ROOT } from '../config/env.js';
import type { Db } from '../db/pool.js';
import { ENGINE_VERSION } from '../game/constants.js';
import { datasetStats, exportDataset } from './dataset.js';
import { buildMissingExamples } from './examples.js';
import { FEATURE_NAMES, FEATURE_SCHEMA_VERSION, ML_TASK } from './features.js';
import { getActiveModel, pingPython } from './predictor.js';

const TRAIN_TIMEOUT_MS = 10 * 60_000;
let trainingInProgress = false;

export class MlError extends Error {}

interface TrainScriptResult {
  ok: boolean;
  error?: string;
  model_type?: string;
  params?: Record<string, unknown>;
  features?: string[];
  metrics?: Record<string, number | null>;
  baseline_metrics?: Record<string, number | null>;
  data_stats?: Record<string, unknown>;
  eligible?: boolean;
  eligibility_reasons?: string[];
  training_seconds?: number;
  [k: string]: unknown;
}

function runPython(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(env.pythonBin, args, { cwd: REPO_ROOT, stdio: 'pipe' });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => proc.kill(), TRAIN_TIMEOUT_MS);
    proc.stdout.on('data', (d) => (stdout += d));
    proc.stderr.on('data', (d) => (stderr += d));
    proc.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `Cannot start Python (${env.pythonBin}): ${e.message}` });
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function newVersion(snapshotId: number): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `m${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-s${snapshotId}`;
}

export async function trainModel(db: Db, opts: { activate?: boolean; seed?: number } = {}) {
  if (trainingInProgress) throw new MlError('A training job is already running');
  trainingInProgress = true;
  try {
    const built = await buildMissingExamples(db);
    const snapshot = await exportDataset(db);
    const version = newVersion(snapshot.snapshotId);
    const outDirRel = `${path.relative(REPO_ROOT, env.artifactsDir).split(path.sep).join('/')}/models/${version}`;
    const res = await runPython([
      path.join('ml', 'train.py'), '--dataset', snapshot.csvPath, '--out-dir', outDirRel, '--version', version,
      '--seed', String(opts.seed ?? 42), '--engine-version', snapshot.engineVersion,
    ]);
    const lastLine = res.stdout.trim().split(/\r?\n/).pop() ?? '';
    let result: TrainScriptResult;
    try {
      result = JSON.parse(lastLine);
    } catch {
      throw new MlError(`Training script failed (exit ${res.code}): ${(res.stderr || res.stdout).trim().slice(-600)}`);
    }
    if (!result.ok) return { trained: false as const, error: result.error ?? 'unknown error', snapshot, examplesBuilt: built.inserted, dataStats: result.data_stats ?? null };

    // The model must have been trained on exactly the feature list the server sends at inference time.
    if (JSON.stringify(result.features) !== JSON.stringify(FEATURE_NAMES)) {
      throw new MlError('Trained feature list does not match FEATURE_NAMES — refusing to register the model');
    }
    const ins = await db.query(
      `INSERT INTO model_versions (version, model_type, task, feature_schema_version, engine_version, dataset_snapshot_id, artifact_path, params, metrics,
         baseline_metrics, data_stats, eligible, eligibility_reasons, training_seconds)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [version, result.model_type, ML_TASK, FEATURE_SCHEMA_VERSION, snapshot.engineVersion, snapshot.snapshotId, outDirRel, JSON.stringify(result.params),
        JSON.stringify(result.metrics), JSON.stringify(result.baseline_metrics),
        JSON.stringify({ ...result.data_stats, feature_importance_gain: result.feature_importance_gain }),
        !!result.eligible, JSON.stringify(result.eligibility_reasons ?? []), result.training_seconds ?? 0],
    );
    let activated = false;
    if (opts.activate && result.eligible) {
      await activateModel(db, version);
      activated = true;
    }
    return { trained: true as const, model: ins.rows[0], activated, snapshot, examplesBuilt: built.inserted };
  } finally {
    trainingInProgress = false;
  }
}

export function isTrainingInProgress() {
  return trainingInProgress;
}

/** Make `version` the single active model. Only eligible models of the current feature schema AND engine version can be activated. */
export async function activateModel(db: Db, version: string) {
  const r = await db.query('SELECT * FROM model_versions WHERE version = $1', [version]);
  const m = r.rows[0];
  if (!m) throw new MlError(`Model ${version} not found`);
  if (!m.eligible) throw new MlError(`Model ${version} is not eligible: ${(m.eligibility_reasons as string[]).filter((x) => x.startsWith('FAIL')).join('; ')}`);
  if (m.feature_schema_version !== FEATURE_SCHEMA_VERSION) {
    throw new MlError(`Model ${version} uses feature schema ${m.feature_schema_version}; the code uses ${FEATURE_SCHEMA_VERSION}`);
  }
  if (m.engine_version !== ENGINE_VERSION) {
    throw new MlError(`Model ${version} was trained on engine ${m.engine_version} data; current game rules are engine ${ENGINE_VERSION} — retrain on current data`);
  }
  await db.query('UPDATE model_versions SET is_active = false WHERE is_active');
  await db.query('UPDATE model_versions SET is_active = true, activated_at = now() WHERE version = $1', [version]);
}

/** Deactivate any active model → the boss uses the transparent baseline. */
export async function deactivateModels(db: Db) {
  await db.query('UPDATE model_versions SET is_active = false WHERE is_active');
}

export async function listModels(db: Db) {
  return (await db.query(
    `SELECT m.*, s.row_count AS snapshot_rows, s.file_path AS snapshot_path FROM model_versions m
     LEFT JOIN dataset_snapshots s ON s.id = m.dataset_snapshot_id ORDER BY m.id DESC`)).rows;
}

/** Everything the UI needs to state honestly: data collected? model trained? loaded/active? used in the latest decision? */
export async function mlStatus(db: Db, opts: { pingPython?: boolean } = {}) {
  const dataset = await datasetStats(db);
  const active = await getActiveModel(db);
  const models = (await db.query(
    'SELECT count(*)::int AS n, count(*) FILTER (WHERE eligible)::int AS eligible FROM model_versions')).rows[0];
  const latestDecision = (await db.query(
    `SELECT d.run_id, d.for_round_number, d.created_at, d.predictor->>'kind' AS kind, d.predictor->>'modelVersion' AS model_version,
       d.predictor->>'fallbackReason' AS fallback_reason, (d.predictor->>'probabilityRanged')::float AS probability_ranged, r.source
     FROM boss_decisions d JOIN runs r ON r.id = d.run_id ORDER BY d.id DESC LIMIT 1`)).rows[0] ?? null;
  // Current engine only, split by basis (rule / unknown / model / baseline). Older-engine decisions have no basis
  // (their round-1 "0.5" was a placeholder, not an estimate) and are not mixed in (V2_DEMANDS D-P0-5).
  const usage = (await db.query(
    `SELECT d.predictor->>'kind' AS kind, COALESCE(d.predictor->>'basis', 'legacy') AS basis, count(*)::int AS n
     FROM boss_decisions d JOIN runs r ON r.id = d.run_id WHERE r.engine_version = $1 GROUP BY 1, 2 ORDER BY 1, 2`, [ENGINE_VERSION])).rows;
  const snapshots = (await db.query('SELECT * FROM dataset_snapshots ORDER BY id DESC LIMIT 5')).rows;
  return {
    task: ML_TASK,
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    featureNames: FEATURE_NAMES,
    dataset,
    snapshots,
    models: { total: models.n, eligible: models.eligible },
    activeModel: active,
    trainingInProgress,
    latestDecision,
    decisionUsage: usage.reduce((acc: Record<string, number>, u) => ({ ...acc, [u.kind]: (acc[u.kind] ?? 0) + u.n }), {}),
    decisionBasis: usage.reduce((acc: Record<string, number>, u) => ({ ...acc, [u.basis]: (acc[u.basis] ?? 0) + u.n }), {}),
    python: opts.pingPython ? await pingPython() : null,
  };
}
