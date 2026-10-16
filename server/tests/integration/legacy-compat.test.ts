/**
 * Engine 2.0.0 compatibility with pre-V2 data (V2_DEMANDS AC-CAT-3, Q-2):
 *  - runs created under engine 1.x (incl. items that no longer exist, e.g. the Axe) still load through the API,
 *    with derived numbers computed from their own (V1) catalogue;
 *  - they are view-only: preparation actions and new rounds are refused, ending the run is allowed;
 *  - rebuilding training rows for them does not crash.
 */
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/api/app.js';
import { closePool, getPool } from '../../src/db/pool.js';
import { buildMissingExamples } from '../../src/ml/examples.js';
import { stopInferenceWorker } from '../../src/ml/predictor.js';
import { startRound } from '../../src/services/rounds.js';
import { createReadyRun, resetTables, useTestDatabase } from '../helpers/db.js';

const app = createApp();

beforeAll(useTestDatabase);
beforeEach(resetTables);
afterAll(async () => {
  stopInferenceWorker();
  await closePool();
});

/** Play two rounds under the live engine, then relabel the run as an engine-1.1.0 run holding a V1-only Axe. */
async function legacyRun(): Promise<{ runId: number; roundId: number }> {
  const runId = await createReadyRun({ seed: 'legacy-1' });
  await startRound(runId);
  await startRound(runId);
  const db = getPool();
  // TEST FIXTURE: stand-in for a historical engine-1.1.0 run (V1 Axe owned and equipped, also in a round snapshot).
  await db.query(`UPDATE runs SET engine_version = '1.1.0' WHERE id = $1`, [runId]);
  await db.query(`UPDATE rounds SET engine_version = '1.1.0' WHERE run_id = $1`, [runId]);
  await db.query(
    `UPDATE combatants SET inventory = '["axe"]'::jsonb, loadout = '{"hand1":"axe","hand2":null,"armour":null}'::jsonb
     WHERE run_id = $1 AND side = 'player'`, [runId]);
  await db.query(
    `UPDATE rounds SET player_post = jsonb_set(jsonb_set(player_post, '{inventory}', '["axe"]'), '{loadout}', '{"hand1":"axe","hand2":null,"armour":null}'),
       player_snapshot = jsonb_set(player_snapshot, '{loadout}', '{"hand1":"axe","hand2":null,"armour":null}')
     WHERE run_id = $1`, [runId]);
  await db.query('DELETE FROM training_examples WHERE run_id = $1', [runId]);
  const roundId = (await db.query('SELECT id FROM rounds WHERE run_id = $1 AND round_number = 1', [runId])).rows[0].id;
  return { runId, roundId };
}

describe('legacy (engine 1.x) runs under engine 2.0.0', () => {
  it('load through the API with V1 catalogue numbers', async () => {
    const { runId, roundId } = await legacyRun();
    const v = await request(app).get(`/api/runs/${runId}`);
    expect(v.status).toBe(200);
    // V1 Axe: +5 STR → Net ATK = STR × (1 + 0.25 × 5)
    expect(v.body.player.derived.meleeWeaponId).toBe('axe');
    expect(v.body.player.derived.netAtk).toBeCloseTo(v.body.player.stats.str * (1 + 0.25 * 5));
    const r = await request(app).get(`/api/rounds/${roundId}`);
    expect(r.status).toBe(200);
    expect(r.body.events.length).toBeGreaterThan(0);
  });

  it('are view-only: prep and new rounds refused, ending allowed; rows untouched', async () => {
    const { runId } = await legacyRun();
    for (const [path, body] of [
      ['allocate', { stat: 'hp', points: 1 }],
      ['buy', { itemId: 'knuckle' }],
      ['loadout', { hand1: null, hand2: null, armour: null }],
    ] as const) {
      const res = await request(app).post(`/api/runs/${runId}/${path}`).send(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/older rules \(engine 1\.1\.0\)/);
    }
    const nr = await request(app).post(`/api/runs/${runId}/rounds`).send({});
    expect(nr.status).toBe(400);
    expect(nr.body.error).toMatch(/older rules/);
    const run = (await getPool().query('SELECT engine_version, status FROM runs WHERE id = $1', [runId])).rows[0];
    expect(run).toEqual({ engine_version: '1.1.0', status: 'active' });
    const end = await request(app).post(`/api/runs/${runId}/end`).send({});
    expect(end.status).toBe(200);
  });

  it('training rows can be rebuilt without crashing on removed items', async () => {
    const { runId } = await legacyRun();
    await buildMissingExamples(getPool());
    const rows = (await getPool().query('SELECT engine_version, features FROM training_examples WHERE run_id = $1', [runId])).rows;
    expect(rows.length).toBe(1);
    expect(rows[0].engine_version).toBe('1.1.0');
    expect(rows[0].features.p_owns_melee).toBe(1);
  });
});
