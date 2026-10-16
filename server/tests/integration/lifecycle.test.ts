/**
 * Integration tests (real PostgreSQL): run → round → rewards → analysis → boss adaptation,
 * pause/resume of player choices, persistence across a pool restart, boss legality/affordability
 * over a full run, training-example append, and honest ML fallback reporting.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, getPool, setDatabaseUrl } from '../../src/db/pool.js';
import { env } from '../../src/config/env.js';
import { isLegalLoadout } from '../../src/game/equipment.js';
import { stopInferenceWorker } from '../../src/ml/predictor.js';
import { buy, getRunView, setLoadout } from '../../src/services/runs.js';
import { ENGINE_VERSION } from '../../src/game/constants.js';
import { getRoundDetail, startRound, submitChoice } from '../../src/services/rounds.js';
import { createReadyRun, resetTables, useTestDatabase } from '../helpers/db.js';

beforeAll(useTestDatabase);
beforeEach(resetTables);
afterAll(async () => {
  stopInferenceWorker();
  await closePool();
});

describe('round lifecycle', () => {
  it('plays round 1 end-to-end and persists everything', async () => {
    const runId = await createReadyRun({ seed: 'test-seed-1', maxRounds: 3 });
    const roundId = await startRound(runId);
    const d = await getRoundDetail(getPool(), roundId);
    expect(d.round.status).toBe('completed');
    expect(d.events.length).toBeGreaterThan(0);
    expect(d.events.every((e) => e.mode === 'unarmed')).toBe(true);
    expect(d.analysis.roundNumber).toBe(1);
    expect(d.decision.predictor.kind).toBe('fallback');
    expect(d.decision.predictor.fallbackReason).toMatch(/No completed rounds/);

    const v = await getRunView(getPool(), runId);
    const winner = d.round.winner;
    const w = winner === 'player' ? v.player : v.boss;
    const l = winner === 'player' ? v.boss : v.player;
    expect([w.xp, w.gold]).toEqual([50, 10]);
    expect([l.xp, l.gold]).toEqual([30, 5]);
    const kinds = d.progression.map((p: any) => p.kind);
    expect(kinds.filter((k: string) => k === 'xp').length).toBe(2);
  });

  it('round 2 appends a training example and the boss decision uses history', async () => {
    const runId = await createReadyRun({ seed: 'test-seed-2', maxRounds: 5 });
    await startRound(runId);
    await buy(runId, 'knuckle');
    await setLoadout(runId, { hand1: 'knuckle', hand2: null, armour: null });
    const r2 = await startRound(runId);
    const d = await getRoundDetail(getPool(), r2);
    expect(d.decision.evidence.sourceRound).toBe(1);
    expect(d.decision.predictor.features).not.toBeNull();
    const ex = await getPool().query('SELECT * FROM training_examples WHERE run_id = $1', [runId]);
    expect(ex.rowCount).toBe(1);
    expect(ex.rows[0].features.next_round_number).toBe(2);
    expect(ex.rows[0].label).toBe(0); // melee knuckle → not ranged
  });

  it('pauses for a Ranged+Melee player and resumes with choices', async () => {
    const runId = await createReadyRun({ seed: 'test-seed-3', maxRounds: 3 });
    // TEST FIXTURE: grant gold directly so the player can afford a bow + sword in round 1.
    await getPool().query(`UPDATE combatants SET gold = 25 WHERE run_id = $1 AND side = 'player'`, [runId]);
    await buy(runId, 'bow');
    await buy(runId, 'sword');
    await setLoadout(runId, { hand1: 'bow', hand2: 'sword', armour: null });
    const roundId = await startRound(runId);
    let d = await getRoundDetail(getPool(), roundId);
    expect(d.round.status).toBe('in_progress');
    expect(d.round.pending_choice.options).toEqual(['ranged', 'melee']);
    expect(d.events.some((e) => e.phase === 'opening' && e.attacker === 'player')).toBe(true);
    await expect(startRound(runId)).rejects.toThrow(/in progress/);
    await submitChoice(roundId, 'melee');
    await submitChoice(roundId, 'ranged', true);
    d = await getRoundDetail(getPool(), roundId);
    expect(d.round.status).toBe('completed');
    expect(d.events.some((e) => e.choiceSource === 'player')).toBe(true);
    expect(d.events.some((e) => e.choiceSource === 'player_auto')).toBe(true);
  });

  it('history survives a connection-pool restart', async () => {
    const runId = await createReadyRun({ seed: 'test-seed-4', maxRounds: 3 });
    await startRound(runId);
    const before = await getRunView(getPool(), runId);
    await setDatabaseUrl(env.testDatabaseUrl); // closes and recreates the pool
    const after = await getRunView(getPool(), runId);
    expect(after.player).toEqual(before.player);
    expect(after.rounds.length).toBe(1);
    expect(after.lastAnalysis).not.toBeNull();
  });
});

describe('boss legality over a full run', () => {
  it('every boss decision is affordable and legal; run closes at max rounds', async () => {
    const runId = await createReadyRun({ seed: 'test-seed-5', maxRounds: 8 });
    for (let i = 0; i < 8; i++) await startRound(runId);
    const decisions = (await getPool().query('SELECT * FROM boss_decisions WHERE run_id = $1 ORDER BY for_round_number', [runId])).rows;
    expect(decisions.length).toBe(8);
    for (const d of decisions) {
      expect(d.gold_spent).toBeLessThanOrEqual(d.state_before.gold);
      expect(d.state_after.gold).toBe(d.state_before.gold - d.gold_spent);
      expect(d.state_after.gold).toBeGreaterThanOrEqual(0);
      expect(d.state_after.statPoints).toBeGreaterThanOrEqual(0);
      expect(isLegalLoadout(d.state_after.loadout, d.state_after.inventory)).toBe(true);
      expect(d.selected.rationale.length).toBeGreaterThan(0);
    }
    const run = (await getPool().query('SELECT status, end_reason FROM runs WHERE id = $1', [runId])).rows[0];
    expect(run).toEqual({ status: 'completed', end_reason: 'max_rounds' });
    await expect(startRound(runId)).rejects.toThrow(/completed/);
    const ex = await getPool().query('SELECT count(*)::int AS n FROM training_examples WHERE run_id = $1', [runId]);
    expect(ex.rows[0].n).toBe(7);
  });
});

describe('ML fallback honesty', () => {
  it('reports fallback when the active model artifact is missing', async () => {
    await getPool().query(
      `INSERT INTO model_versions (version, model_type, task, feature_schema_version, engine_version, artifact_path, params, metrics, baseline_metrics,
         data_stats, eligible, eligibility_reasons, is_active, training_seconds)
       VALUES ('test-missing','xgboost','t','v1',$1,'artifacts/models/does-not-exist','{}','{}','{}','{}',true,'[]',true,0)`, [ENGINE_VERSION]);
    const runId = await createReadyRun({ seed: 'test-seed-6', maxRounds: 3 });
    await startRound(runId);
    const r2 = await startRound(runId);
    const d = await getRoundDetail(getPool(), r2);
    expect(d.decision.predictor.kind).toBe('fallback');
    expect(d.decision.predictor.fallbackReason).toMatch(/artifact missing/);
  });
});
