/**
 * ML pipeline integration tests (real PostgreSQL + real Python/XGBoost):
 *  - feature leakage: the player's round-(N+1) preparation cannot change the features (or the boss's
 *    decision) for round N+1 — only the label;
 *  - dataset export writes a traceable snapshot;
 *  - train → eligibility gate → activation → the boss actually uses the model and records its version.
 * Artifacts are written to a temp directory, not the repo.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { env, REPO_ROOT } from '../../src/config/env.js';
import { closePool, getPool } from '../../src/db/pool.js';
import { exportDataset } from '../../src/ml/dataset.js';
import { buildFeatures, FEATURE_NAMES } from '../../src/ml/features.js';
import { stopInferenceWorker } from '../../src/ml/predictor.js';
import { activateModel, trainModel } from '../../src/ml/training.js';
import { loadCompletedRounds } from '../../src/services/history.js';
import { getRoundDetail, startRound } from '../../src/services/rounds.js';
import { buy, setLoadout } from '../../src/services/runs.js';
import { createBatch, executeBatch, normalizeConfig } from '../../src/sim/runner.js';
import { createReadyRun, resetTables, useTestDatabase } from '../helpers/db.js';

const tmpArtifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'boss-ml-test-'));
const originalArtifacts = env.artifactsDir;

beforeAll(async () => {
  env.artifactsDir = tmpArtifacts;
  await useTestDatabase();
});
beforeEach(resetTables);
afterAll(async () => {
  env.artifactsDir = originalArtifacts;
  stopInferenceWorker();
  await closePool();
  fs.rmSync(tmpArtifacts, { recursive: true, force: true });
});

describe('feature leakage boundary', () => {
  it("player's round-2 preparation changes the label but not the features or the boss's decision", async () => {
    const play = async (goRanged: boolean) => {
      const runId = await createReadyRun({ seed: 'leak-seed', maxRounds: 3 });
      await startRound(runId);
      if (goRanged) {
        // TEST FIXTURE: grant gold so the player can switch to a bow before round 2.
        await getPool().query(`UPDATE combatants SET gold = gold + 20 WHERE run_id = $1 AND side = 'player'`, [runId]);
        await buy(runId, 'bow');
        await setLoadout(runId, { hand1: 'bow', hand2: null, armour: null });
      }
      const r2 = await startRound(runId);
      const ex = (await getPool().query('SELECT * FROM training_examples WHERE run_id = $1', [runId])).rows[0];
      return { runId, ex, decision: (await getRoundDetail(getPool(), r2)).decision };
    };
    const melee = await play(false);
    const ranged = await play(true);
    expect(melee.ex.label).toBe(0);
    expect(ranged.ex.label).toBe(1);
    expect(ranged.ex.features).toEqual(melee.ex.features);
    expect(ranged.decision.selected.plan).toEqual(melee.decision.selected.plan);
    expect(ranged.decision.predictor.probabilityRanged).toBe(melee.decision.predictor.probabilityRanged);
    // Stored features are exactly buildFeatures(rounds 1..N).
    const hist = (await loadCompletedRounds(getPool(), ranged.runId, 1)).map((h) => h.record);
    expect(ranged.ex.features).toEqual(buildFeatures(hist));
    expect(Object.keys(ranged.ex.features).sort()).toEqual([...FEATURE_NAMES].sort());
  });
});

describe('training pipeline', () => {
  it('exports, trains, gates eligibility, and the boss uses an active model', async () => {
    const batch = await createBatch(normalizeConfig({
      runs: 8, maxRounds: 5, strategies: ['archer', 'melee_bruiser', 'hybrid', 'adaptive'], seed: 'ml-test-data',
    }));
    await executeBatch(batch);

    const snap = await exportDataset(getPool());
    // 8 runs × label rounds 2..5; rows where the player never attacked are invalid and excluded.
    expect(snap.rowCount + snap.invalidExcluded).toBe(32);
    const csv = fs.readFileSync(path.resolve(REPO_ROOT, snap.csvPath), 'utf8').trim().split('\n');
    expect(csv.length).toBe(snap.rowCount + 1);
    expect(csv[0].split(',').slice(7)).toEqual([...FEATURE_NAMES]);

    const res = await trainModel(getPool());
    expect(res.trained).toBe(true);
    if (!res.trained) return;
    const m = res.model;
    expect(m.eligible).toBe(false); // 32 rows < 200 → must not be eligible
    expect(m.eligibility_reasons.some((r: string) => r.startsWith('FAIL') && r.includes('rows'))).toBe(true);
    expect(m.data_stats.group_overlap).toBe(0);
    expect(typeof m.metrics.log_loss).toBe('number');
    expect(typeof m.baseline_metrics.log_loss).toBe('number');
    expect(fs.existsSync(path.resolve(REPO_ROOT, m.artifact_path, 'model.json'))).toBe(true);
    await expect(activateModel(getPool(), m.version)).rejects.toThrow(/not eligible/);

    // TEST FIXTURE: force eligibility to exercise the real inference path (Python worker + XGBoost).
    await getPool().query('UPDATE model_versions SET eligible = true WHERE version = $1', [m.version]);
    await activateModel(getPool(), m.version);
    const runId = await createReadyRun({ seed: 'ml-use', maxRounds: 3 });
    await startRound(runId);
    const r2 = await startRound(runId);
    const p = (await getRoundDetail(getPool(), r2)).decision.predictor;
    expect(p.kind).toBe('model');
    expect(p.modelVersion).toBe(m.version);
    expect(p.probabilityRanged).toBeGreaterThan(0);
    expect(p.probabilityRanged).toBeLessThan(1);
    expect(p.fallbackReason).toBeNull();
  });
});
