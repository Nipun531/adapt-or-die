/**
 * ML INFERENCE INTERFACE used by the boss decision layer.
 *
 * predictPlayerStyle() returns P(player mostly ranged next round) and says honestly where it came from:
 *   kind = 'model'    → the ACTIVE, ELIGIBLE XGBoost model scored the features (version recorded)
 *   kind = 'fallback' → transparent baseline was used, with the reason (no active model, schema mismatch,
 *                       model trained on a different engine version (older rules),
 *                       artifact missing, Python unavailable, timeout, worker error, ...)
 * The Python worker (ml/infer_worker.py) is spawned lazily and reused; any failure → fallback.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { env, REPO_ROOT } from '../config/env.js';
import type { Db } from '../db/pool.js';
import { ENGINE_VERSION } from '../game/constants.js';
import { FEATURE_NAMES, FEATURE_SCHEMA_VERSION, type FeatureVector } from './features.js';

export interface Prediction {
  kind: 'model' | 'fallback';
  probabilityRanged: number;
  baselineProbability: number;
  modelVersion: string | null;
  fallbackReason: string | null;
  featureSchemaVersion: string;
  features: FeatureVector | null;
}

const TIMEOUT_MS = 15_000;

class Worker {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private queue: ((line: string) => void)[] = [];
  loadedVersion: string | null = null;

  private start() {
    const script = path.join(REPO_ROOT, 'ml', 'infer_worker.py');
    const proc = spawn(env.pythonBin, [script], { stdio: 'pipe' });
    proc.on('error', () => this.reset());
    proc.on('exit', () => this.reset());
    proc.stderr.on('data', () => undefined); // ignore warnings; errors arrive as JSON
    readline.createInterface({ input: proc.stdout }).on('line', (line) => this.queue.shift()?.(line));
    this.proc = proc;
  }

  private reset() {
    this.proc = null;
    this.loadedVersion = null;
    const pending = this.queue.splice(0);
    pending.forEach((cb) => cb(JSON.stringify({ ok: false, error: 'python worker exited' })));
  }

  async send(msg: object): Promise<{ ok: boolean; error?: string; probability?: number; xgboost?: string }> {
    if (!this.proc) this.start();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const i = this.queue.indexOf(cb);
        if (i >= 0) this.queue.splice(i, 1);
        this.stop();
        resolve({ ok: false, error: `python worker timed out after ${TIMEOUT_MS}ms` });
      }, TIMEOUT_MS);
      const cb = (line: string) => {
        clearTimeout(timer);
        try { resolve(JSON.parse(line)); } catch { resolve({ ok: false, error: `bad worker output: ${line.slice(0, 80)}` }); }
      };
      this.queue.push(cb);
      try {
        this.proc!.stdin.write(JSON.stringify(msg) + '\n');
      } catch (e) {
        clearTimeout(timer);
        this.queue.pop();
        resolve({ ok: false, error: `cannot write to python worker: ${(e as Error).message}` });
      }
    });
  }

  stop() {
    if (this.proc) this.proc.kill();
    this.proc = null;
    this.loadedVersion = null;
  }
}

const worker = new Worker();
export function stopInferenceWorker() {
  worker.stop();
}

export interface ActiveModel {
  version: string;
  artifact_path: string;
  feature_schema_version: string;
  engine_version: string;
  eligible: boolean;
}

export async function getActiveModel(db: Db): Promise<ActiveModel | null> {
  const r = await db.query(
    `SELECT version, artifact_path, feature_schema_version, engine_version, eligible FROM model_versions WHERE is_active LIMIT 1`,
  );
  return r.rows[0] ?? null;
}

/** Check Python + xgboost availability (used by /api/health and ml:status). */
export async function pingPython(): Promise<{ ok: boolean; detail: string }> {
  const r = await worker.send({ cmd: 'ping' });
  return r.ok ? { ok: true, detail: `xgboost ${r.xgboost}` } : { ok: false, detail: r.error ?? 'unknown error' };
}

export async function predictPlayerStyle(db: Db, features: FeatureVector | null, baseline: number): Promise<Prediction> {
  const fallback = (reason: string): Prediction => ({
    kind: 'fallback', probabilityRanged: baseline, baselineProbability: baseline, modelVersion: null,
    fallbackReason: reason, featureSchemaVersion: FEATURE_SCHEMA_VERSION, features,
  });
  if (!features) return fallback('No completed rounds yet — nothing to predict from');
  const model = await getActiveModel(db);
  if (!model) return fallback('No active trained model (train + activate one in the ML lab)');
  if (!model.eligible) return fallback(`Active model ${model.version} is not eligible`);
  if (model.feature_schema_version !== FEATURE_SCHEMA_VERSION) {
    return fallback(`Model ${model.version} uses feature schema ${model.feature_schema_version}, code uses ${FEATURE_SCHEMA_VERSION}`);
  }
  if (model.engine_version !== ENGINE_VERSION) {
    return fallback(`Model ${model.version} was trained on engine ${model.engine_version} data; current rules are engine ${ENGINE_VERSION} (retrain)`);
  }
  const modelPath = path.resolve(REPO_ROOT, model.artifact_path, 'model.json');
  if (!fs.existsSync(modelPath)) return fallback(`Model artifact missing at ${model.artifact_path}`);
  if (worker.loadedVersion !== model.version) {
    const res = await worker.send({ cmd: 'load', model_path: modelPath, features: FEATURE_NAMES });
    if (!res.ok) return fallback(`Could not load model ${model.version}: ${res.error}`);
    worker.loadedVersion = model.version;
  }
  const res = await worker.send({ cmd: 'predict', features });
  if (!res.ok || typeof res.probability !== 'number' || !Number.isFinite(res.probability)) {
    return fallback(`Model inference failed: ${res.error ?? 'invalid probability'}`);
  }
  return {
    kind: 'model', probabilityRanged: res.probability, baselineProbability: baseline, modelVersion: model.version,
    fallbackReason: null, featureSchemaVersion: FEATURE_SCHEMA_VERSION, features,
  };
}
