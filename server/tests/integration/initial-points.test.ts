/**
 * Engine 1.1.0 rule: both combatants start every run with exactly 2 unallocated stat points, spent before round 1.
 * Covers: grant at creation (+ ledger), round-1 gate, boss spending via its policy, allocation increments,
 * no re-grant on refresh/resume/pool restart, concurrent/repeated allocation requests, simulated runs, and
 * ML data/model versioning (legacy engine-1.0.0 rows and models are kept but not mixed in or used).
 */
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/api/app.js';
import { env } from '../../src/config/env.js';
import { closePool, getPool, setDatabaseUrl } from '../../src/db/pool.js';
import { BASE_STATS, ENGINE_VERSION, INITIAL_STAT_POINTS, STAT_ALLOCATION_INCREASE } from '../../src/game/constants.js';
import type { Stats } from '../../src/game/types.js';
import { datasetStats, exportDataset } from '../../src/ml/dataset.js';
import { FEATURE_SCHEMA_VERSION } from '../../src/ml/features.js';
import { predictPlayerStyle, stopInferenceWorker } from '../../src/ml/predictor.js';
import { activateModel } from '../../src/ml/training.js';
import { allocate } from '../../src/services/runs.js';
import { SIMULATOR_VERSION, STRATEGY_NAMES } from '../../src/sim/agents.js';
import { createBatch, executeBatch, normalizeConfig } from '../../src/sim/runner.js';
import { resetTables, useTestDatabase, finishRound } from '../helpers/db.js';

const app = createApp();
beforeAll(useTestDatabase);
beforeEach(resetTables);
afterAll(async () => {
  stopInferenceWorker();
  await closePool();
});

/** Number of allocation points that explain the difference between `stats` and `base` (exact multiples only). */
function pointsSpent(stats: Stats, base: Stats = BASE_STATS): number {
  let n = 0;
  for (const k of Object.keys(base) as (keyof Stats)[]) {
    const diff = stats[k] - base[k];
    expect(diff % STAT_ALLOCATION_INCREASE[k]).toBe(0);
    expect(diff).toBeGreaterThanOrEqual(0);
    n += diff / STAT_ALLOCATION_INCREASE[k];
  }
  return n;
}
const ledger = async (runId: number, kind: string) =>
  (await getPool().query('SELECT * FROM progression_events WHERE run_id = $1 AND kind = $2 ORDER BY id', [runId, kind])).rows;

describe('manual runs', () => {
  it('a new run grants exactly 2 points to each side, recorded once in the ledger and run config', async () => {
    const v = (await request(app).post('/api/runs').send({ maxRounds: 3, seed: 'ip-1' })).body;
    expect(v.player.statPoints).toBe(INITIAL_STAT_POINTS);
    expect(v.boss.statPoints).toBe(INITIAL_STAT_POINTS);
    expect(v.player.stats).toEqual(BASE_STATS);
    expect(v.run.engine_version).toBe(ENGINE_VERSION);
    expect(v.run.config.initialStatPoints).toBe(2);
    const grants = await ledger(v.run.id, 'initial_points');
    expect(grants.map((g) => [g.side, g.actor, g.payload.points])).toEqual([['player', 'rules', 2], ['boss', 'rules', 2]]);
    const cat = (await request(app).get('/api/catalog')).body;
    expect(cat.rules.initialStatPoints).toBe(2);
  });

  it('round 1 cannot start until the player has spent both points; a rejected start changes nothing', async () => {
    const id = (await request(app).post('/api/runs').send({ maxRounds: 3, seed: 'ip-2' })).body.run.id;
    let r = await request(app).post(`/api/runs/${id}/rounds`);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Allocate your 2 initial stat point/);
    await request(app).post(`/api/runs/${id}/allocate`).send({ stat: 'hp', points: 1 });
    r = await request(app).post(`/api/runs/${id}/rounds`);
    expect(r.body.error).toMatch(/Allocate your 1 initial stat point/);
    // The failed attempts rolled back: no round, no boss decision, boss still holds its 2 points.
    const counts = (await getPool().query(
      `SELECT (SELECT count(*) FROM rounds WHERE run_id=$1)::int AS rounds, (SELECT count(*) FROM boss_decisions WHERE run_id=$1)::int AS decisions,
              (SELECT stat_points FROM combatants WHERE run_id=$1 AND side='boss') AS boss_points`, [id])).rows[0];
    expect(counts).toEqual({ rounds: 0, decisions: 0, boss_points: 2 });
  });

  it('both sides enter round 1 with their points spent by the normal increments; the boss uses its policy', async () => {
    const id = (await request(app).post('/api/runs').send({ maxRounds: 3, seed: 'ip-3' })).body.run.id;
    await request(app).post(`/api/runs/${id}/allocate`).send({ stat: 'dex', points: 1 });
    const v = (await request(app).post(`/api/runs/${id}/allocate`).send({ stat: 'str', points: 1 })).body;
    expect(v.player.stats).toEqual({ hp: 100, str: 23, def: 10, dex: 12 });
    expect(v.player.statPoints).toBe(0);
    const d = (await request(app).post(`/api/runs/${id}/rounds`)).body;
    expect(d.round.round_number).toBe(1);
    const round = (await getPool().query('SELECT player_pre, boss_pre FROM rounds WHERE id = $1', [d.round.id])).rows[0];
    expect(round.player_pre.statPoints).toBe(0);
    expect(round.boss_pre.statPoints).toBe(0);
    expect(pointsSpent(round.player_pre.stats)).toBe(2);
    expect(pointsSpent(round.boss_pre.stats)).toBe(2);
    // Boss decision for round 1 records the allocation, the constraint it had, and a legal result.
    const dec = d.decision;
    expect(dec.evidence.constraints.statPointsAvailable).toBe(2);
    const alloc = dec.actions.filter((a: any) => a.kind === 'stat_allocation');
    expect(alloc.reduce((s: number, a: any) => s + a.detail.points, 0)).toBe(2);
    expect(dec.state_after.statPoints).toBe(0);
    expect(dec.state_after.stats).toEqual(round.boss_pre.stats);
    const bossLedger = (await ledger(id, 'stat_allocation')).filter((e) => e.side === 'boss');
    expect(bossLedger.every((e) => e.actor === 'boss_policy' && e.payload.forRoundNumber === 1)).toBe(true);
  });

  it('refresh, resume and a pool restart never grant the points again; concurrent/repeated allocations cannot exceed 2', async () => {
    const id = (await request(app).post('/api/runs').send({ maxRounds: 3, seed: 'ip-4' })).body.run.id;
    // Three concurrent 1-point requests: row locking serialises them → exactly 2 succeed.
    const results = await Promise.allSettled([1, 2, 3].map(() => allocate(id, 'def', 1)));
    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(2);
    expect(results.filter((r) => r.status === 'rejected').length).toBe(1);
    expect((await request(app).post(`/api/runs/${id}/allocate`).send({ stat: 'def', points: 1 })).status).toBe(400);
    for (let i = 0; i < 3; i++) expect((await request(app).get(`/api/runs/${id}`)).body.player.statPoints).toBe(0);
    await setDatabaseUrl(env.testDatabaseUrl); // simulates a server restart (new pool)
    const after = (await request(app).get(`/api/runs/${id}`)).body;
    expect(after.player.statPoints).toBe(0);
    expect(after.player.stats.def).toBe(14);
    for (let n = 0; n < 2; n++) await finishRound((await request(app).post(`/api/runs/${id}/rounds`)).body.round.id);
    expect((await ledger(id, 'initial_points')).length).toBe(2);
    // After round 1 the only new points come from level-ups: available = 2 initial + level-ups − spent.
    const v = (await request(app).get(`/api/runs/${id}`)).body;
    const levelUps = (await ledger(id, 'level_up')).filter((e) => e.side === 'player').length;
    const spent = (await ledger(id, 'stat_allocation')).filter((e) => e.side === 'player').reduce((s, e) => s + e.payload.points, 0);
    expect(v.player.statPoints).toBe(2 + levelUps - spent);
  });
});

describe('simulated runs', () => {
  it('every simulated run grants and spends the 2 initial points on both sides before round 1', async () => {
    const batch = await createBatch(normalizeConfig({ runs: STRATEGY_NAMES.length, maxRounds: 2, seed: 'ip-sim' }));
    await executeBatch(batch);
    const runs = (await getPool().query('SELECT id, engine_version, simulator_version, config FROM runs WHERE simulation_batch_id = $1', [batch])).rows;
    expect(runs.length).toBe(STRATEGY_NAMES.length);
    for (const run of runs) {
      expect(run.engine_version).toBe(ENGINE_VERSION);
      expect(run.simulator_version).toBe(SIMULATOR_VERSION);
      expect(run.config.initialStatPoints).toBe(2);
      expect((await ledger(run.id, 'initial_points')).length).toBe(2);
      const r1 = (await getPool().query('SELECT player_pre, boss_pre FROM rounds WHERE run_id = $1 AND round_number = 1', [run.id])).rows[0];
      expect(r1.player_pre.statPoints).toBe(0);
      expect(r1.boss_pre.statPoints).toBe(0);
      expect(pointsSpent(r1.player_pre.stats)).toBe(2);
      expect(pointsSpent(r1.boss_pre.stats)).toBe(2);
      const agentAlloc = (await ledger(run.id, 'stat_allocation')).filter((e) => e.actor === 'agent');
      expect(agentAlloc.length).toBeGreaterThan(0);
    }
  });
});

describe('ML data and model versioning', () => {
  it('legacy-engine rows stay stored but are excluded from snapshots; legacy models fall back and cannot be activated', async () => {
    const batch = await createBatch(normalizeConfig({ runs: 4, maxRounds: 3, strategies: ['archer', 'melee_bruiser'], seed: 'ip-ml' }));
    await executeBatch(batch);
    const runIds = (await getPool().query('SELECT id FROM runs WHERE simulation_batch_id = $1 ORDER BY id', [batch])).rows.map((r) => r.id);
    // TEST FIXTURE: relabel one run's derived rows as engine 1.0.0 to stand in for historical data.
    await getPool().query(`UPDATE training_examples SET engine_version = '1.0.0' WHERE run_id = $1`, [runIds[0]]);
    const total = (await getPool().query('SELECT count(*)::int AS n FROM training_examples')).rows[0].n;
    const legacy = (await getPool().query(`SELECT count(*)::int AS n FROM training_examples WHERE engine_version = '1.0.0'`)).rows[0].n;
    expect(legacy).toBe(2);

    const stats = await datasetStats(getPool());
    expect(stats.engineVersion).toBe(ENGINE_VERSION);
    expect(stats.valid + stats.invalid).toBe(total - legacy);
    expect(stats.otherEngineRows).toBe(legacy);
    expect(stats.byEngine.map((e) => e.engine_version).sort()).toEqual(['1.0.0', ENGINE_VERSION].sort());

    const snap = await exportDataset(getPool());
    expect(snap.engineVersion).toBe(ENGINE_VERSION);
    expect(snap.rowCount + snap.invalidExcluded + snap.ruleDeterminedExcluded).toBe(total - legacy);
    const snapRow = (await getPool().query('SELECT engine_version FROM dataset_snapshots WHERE id = $1', [snap.snapshotId])).rows[0];
    expect(snapRow.engine_version).toBe(ENGINE_VERSION);
    const legacySnap = await exportDataset(getPool(), { engineVersion: '1.0.0' });
    expect(legacySnap.rowCount + legacySnap.invalidExcluded + legacySnap.ruleDeterminedExcluded).toBe(legacy);

    // TEST FIXTURE: an eligible, active model trained on engine 1.0.0 data.
    await getPool().query(
      `INSERT INTO model_versions (version, model_type, task, feature_schema_version, engine_version, artifact_path, params, metrics, baseline_metrics,
         data_stats, eligible, eligibility_reasons, is_active, training_seconds)
       VALUES ('legacy-model','xgboost','t',$1,'1.0.0','artifacts/models/legacy','{}','{}','{}','{}',true,'[]',true,0)`, [FEATURE_SCHEMA_VERSION]);
    const features = (await getPool().query('SELECT features FROM training_examples LIMIT 1')).rows[0].features;
    const p = await predictPlayerStyle(getPool(), features, 0.5);
    expect(p.kind).toBe('fallback');
    expect(p.fallbackReason).toMatch(/engine 1\.0\.0 data; current rules are engine 3\.1\.0/);
    await expect(activateModel(getPool(), 'legacy-model')).rejects.toThrow(/trained on engine 1\.0\.0/);
  });
});
