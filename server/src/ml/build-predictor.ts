/**
 * V4 HEAD-MODEL INFERENCE: one XGBoost multi-class model per head (ml/train_build.py writes `<dir>/heads.json` with
 * each head's model file and class order). Scored through the shared Python worker. Any failure → null, and the
 * caller falls back to its baseline forecaster (never a fabricated forecast).
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../config/env.js';
import { HEAD_CLASSES, HEAD_NAMES } from '../boss/build-heads.js';
import { uniformHeads, type HeadProbs } from '../boss/forecast.js';
import type { InMemoryPredictor } from '../sim/balance.js';
import { buildTaskFeatures } from './build-features.js';
import { sendToWorker } from './predictor.js';

interface Manifest { features: string[]; heads: Record<string, { model: string; classes: string[] }> }

const loaded = new Set<string>();

export async function scoreHeads(dir: string, features: Record<string, number | null>): Promise<{ ok: true; heads: HeadProbs } | { ok: false; error: string }> {
  const abs = path.resolve(REPO_ROOT, dir);
  const mf = path.join(abs, 'heads.json');
  if (!fs.existsSync(mf)) return { ok: false, error: `no head-model manifest at ${dir}` };
  const m: Manifest = JSON.parse(fs.readFileSync(mf, 'utf8'));
  const heads = uniformHeads();
  for (const h of HEAD_NAMES) {
    const spec = m.heads[h];
    if (!spec) continue; // a head without a model stays uniform
    const name = `${abs}:${h}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!loaded.has(name)) {
        const r = await sendToWorker({ cmd: 'load_named', name, model_path: path.join(abs, spec.model), features: m.features });
        if (!r.ok) return { ok: false, error: `load ${h}: ${r.error}` };
        loaded.add(name);
      }
      const r = await sendToWorker({ cmd: 'predict_named', name, features });
      if (r.ok && Array.isArray(r.probabilities)) {
        const p: Record<string, number> = Object.fromEntries(HEAD_CLASSES[h].map((c) => [c, 0]));
        spec.classes.forEach((c, i) => { p[c] = r.probabilities![i] ?? 0; });
        heads[h] = p;
        break;
      }
      loaded.delete(name); // the worker may have restarted: reload once
      if (attempt === 1) return { ok: false, error: `predict ${h}: ${r.error}` };
    }
  }
  return { ok: true, heads };
}

/** Harness predictor: model heads for the planner; no history yet → uniform (same as the model has nothing). */
export function headModelPredictor(dir: string): InMemoryPredictor {
  return async (q) => {
    if (!q.records.length) return { heads: uniformHeads() };
    const r = await scoreHeads(dir, buildTaskFeatures(q.records, q.historyHeads));
    if (!r.ok) throw new Error(r.error);
    return { heads: r.heads };
  };
}
