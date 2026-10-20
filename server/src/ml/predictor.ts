/**
 * ML INFERENCE INTERFACE used by the boss decision layer.
 *
 * predictPlayerStyle() returns P(player mostly ranged next round) and says honestly where it came from.
 * `basis` (engine 2.0.0, V2_DEMANDS D-P0-2):
 *   'rule'     → the player cannot field a ranged weapon next round, so P = 0 exactly (no model is asked)
 *   'unknown'  → no evidence yet (e.g. before round 1 with ranged feasible): probabilityRanged = null, the policy
 *                weighs the reachable styles equally as a labelled robustness rule — never a fake 50%
 *   'model'    → the ACTIVE, ELIGIBLE XGBoost model scored the features (version recorded)
 *   'baseline' → transparent baseline was used, with the reason
 * `kind` keeps its V1 meaning: 'model' only for basis 'model', otherwise 'fallback'.
 *   Fallback reasons: no active model, schema mismatch,
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

export type PredictionBasis = 'rule' | 'unknown' | 'model' | 'baseline';

export interface Prediction {
  kind: 'model' | 'fallback';
  basis: PredictionBasis;
  /** null = no evidence (basis 'unknown'). */
  probabilityRanged: number | null;
  baselineProbability: number | null;
  /** Whether the player can field a ranged weapon next round, and why (rule-level, decision-time information). */
  feasibility: { rangedFeasible: boolean; reason: string };
  /** Ensemble models only: the raw XGBoost probability and the blend weight (p = w·model + (1−w)·baseline). */
  modelProbability?: number;
  blendWeight?: number;
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

  async send(msg: object): Promise<{ ok: boolean; error?: string; probability?: number; probabilities?: number[]; xgboost?: string }> {
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
/** V4: raw access to the shared worker for named (multi-class) models — see ml/build-predictor.ts. */
export const sendToWorker = (msg: object) => worker.send(msg);

export interface ActiveModel {
  version: string;
  artifact_path: string;
  feature_schema_version: string;
  engine_version: string;
  eligible: boolean;
  params: { blend_weight?: number } | null;
}

/** Ensemble blend (V2 ensemble candidate): p = w·model + (1−w)·baseline; a baseline with no evidence counts as 0.5. */
export function blendProbability(modelP: number, baseline: number | null, weight: number): number {
  return weight * modelP + (1 - weight) * (baseline ?? 0.5);
}

/**
 * Score one feature vector with a model artifact through the shared Python worker (no database).
 * Used by predictPlayerStyle and by offline evaluation (ml/decision-check.ts).
 */
export async function scoreWithModel(modelPath: string, cacheKey: string, features: FeatureVector): Promise<{ ok: true; p: number } | { ok: false; error: string }> {
  if (worker.loadedVersion !== cacheKey) {
    const res = await worker.send({ cmd: 'load', model_path: modelPath, features: FEATURE_NAMES });
    if (!res.ok) return { ok: false, error: `Could not load model ${cacheKey}: ${res.error}` };
    worker.loadedVersion = cacheKey;
  }
  const res = await worker.send({ cmd: 'predict', features });
  if (!res.ok || typeof res.probability !== 'number' || !Number.isFinite(res.probability)) {
    return { ok: false, error: `Model inference failed: ${res.error ?? 'invalid probability'}` };
  }
  return { ok: true, p: res.probability };
}

export async function getActiveModel(db: Db): Promise<ActiveModel | null> {
  const r = await db.query(
    `SELECT version, artifact_path, feature_schema_version, engine_version, eligible, params FROM model_versions WHERE is_active LIMIT 1`,
  );
  return r.rows[0] ?? null;
}

/** Check Python + xgboost availability (used by /api/health and ml:status). */
export async function pingPython(): Promise<{ ok: boolean; detail: string }> {
  const r = await worker.send({ cmd: 'ping' });
  return r.ok ? { ok: true, detail: `xgboost ${r.xgboost}` } : { ok: false, detail: r.error ?? 'unknown error' };
}

export async function predictPlayerStyle(
  db: Db,
  features: FeatureVector | null,
  baseline: number | null,
  feasibility: { rangedFeasible: boolean; reason: string } = { rangedFeasible: true, reason: 'not checked' },
): Promise<Prediction> {
  const base = { baselineProbability: baseline, modelVersion: null, featureSchemaVersion: FEATURE_SCHEMA_VERSION, features, feasibility };
  if (!feasibility.rangedFeasible) {
    return { ...base, kind: 'fallback', basis: 'rule', probabilityRanged: 0, fallbackReason: `Rule: the player ${feasibility.reason}, so a ranged round is impossible` };
  }
  const fallback = (reason: string): Prediction => baseline === null
    ? { ...base, kind: 'fallback', basis: 'unknown', probabilityRanged: null, fallbackReason: `${reason}; no evidence about the player's style yet` }
    : { ...base, kind: 'fallback', basis: 'baseline', probabilityRanged: baseline, fallbackReason: reason };
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
  const res = await scoreWithModel(modelPath, modelPath, features);
  if (!res.ok) return fallback(res.error);
  const w = model.params?.blend_weight;
  if (typeof w === 'number') {
    return {
      ...base, kind: 'model', basis: 'model', probabilityRanged: blendProbability(res.p, baseline, w), modelProbability: res.p, blendWeight: w,
      modelVersion: model.version, fallbackReason: null,
    };
  }
  return {
    ...base, kind: 'model', basis: 'model', probabilityRanged: res.p, modelVersion: model.version, fallbackReason: null,
  };
}
