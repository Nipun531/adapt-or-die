/**
 * V4 MODE ISOLATION (docs/V4_IMPLEMENTATION_PLAN.md §3, §8): Prepared Boss keeps its global data path; the Learning
 * Boss starts empty, learns only from its own completed rounds and never writes or reads global training data; local
 * PvP is two humans (no boss policy, no boss data) with turn ownership enforced by the server.
 */
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/api/app.js';
import { closePool, getPool, withTransaction } from '../../src/db/pool.js';
import { INITIAL_STAT_POINTS } from '../../src/game/constants.js';
import { stopInferenceWorker } from '../../src/ml/predictor.js';
import { createProfile, startFresh } from '../../src/services/profiles.js';
import { loadObservations } from '../../src/services/learning.js';
import { startRound, submitChoice } from '../../src/services/rounds.js';
import { allocate, createRun } from '../../src/services/runs.js';
import { autoAnswer, createReadyRun, playRound, resetTables, useTestDatabase } from '../helpers/db.js';
import { headsOf } from '../../src/boss/build-heads.js';
import { initialCombatant } from '../../src/game/progression.js';
import { buildMissingBuildExamples } from '../../src/ml/build-examples.js';

const app = createApp();
beforeAll(useTestDatabase);
beforeEach(resetTables);
afterAll(async () => {
  stopInferenceWorker();
  await closePool();
});

const count = async (table: string) => (await getPool().query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n as number;

describe('Prepared Boss (default mode)', () => {
  it('existing-style runs are Prepared Boss runs and feed the global training data', async () => {
    const runId = await createReadyRun({ maxRounds: 2 });
    const run = (await getPool().query('SELECT mode, profile_id FROM runs WHERE id = $1', [runId])).rows[0];
    expect(run).toEqual({ mode: 'prepared', profile_id: null });
    await playRound(runId);
    await playRound(runId);
    expect(await count('training_examples')).toBe(1);
    expect(await count('profile_observations')).toBe(0);
  });
  it('next-build rows: features from rounds 1..N, label = round N+1 heads; Learning/PvP runs never produce rows', async () => {
    const runId = await createReadyRun({ maxRounds: 3 });
    for (let i = 0; i < 3; i++) await playRound(runId);
    const p = await createProfile(getPool(), 'L');
    const lr = await createReadyRun({ maxRounds: 2, mode: 'learning', profileId: p.id });
    await playRound(lr);
    await playRound(lr);
    const r = await buildMissingBuildExamples(getPool());
    expect(r.inserted).toBe(2);
    const rows = (await getPool().query('SELECT b.*, r.round_number FROM build_examples b JOIN rounds r ON r.id = b.label_round_id ORDER BY r.round_number')).rows;
    expect(rows.map((x) => x.round_number)).toEqual([2, 3]);
    expect(rows.every((x) => Number(x.run_id) === runId)).toBe(true);
    const rounds = (await getPool().query('SELECT round_number, player_post, player_snapshot FROM rounds WHERE run_id = $1 ORDER BY round_number', [runId])).rows;
    expect(rows[0].heads).toEqual(headsOf(rounds[0].player_post, rounds[1].player_snapshot));
    // The features of the round-2 label know round 1's choice, never round 2's.
    const h1 = headsOf(initialCombatant('player'), rounds[0].player_snapshot);
    expect(rows[0].features[`last_hands_${h1.hands}`]).toBe(1);
    expect(rows[0].features.next_round_number).toBe(2);
  });
  it('the player cannot prepare the boss side outside PvP', async () => {
    const runId = await createReadyRun({ maxRounds: 1 });
    await expect(allocate(runId, 'str', 1, 'player', undefined, 'boss')).rejects.toThrow(/PvP/);
  });
});

describe('Learning Boss', () => {
  it('starts without a profile, learns only from its own completed rounds, never writes global data', async () => {
    const p = await createProfile(getPool(), 'Ada');
    expect(await loadObservations(getPool(), p.id)).toEqual([]);
    const runId = await createReadyRun({ maxRounds: 3, mode: 'learning', profileId: p.id });
    await playRound(runId);
    await playRound(runId);
    const obs = await loadObservations(getPool(), p.id);
    expect(obs).toHaveLength(2);
    expect(obs[0].context.previousWinner).toBeNull();
    expect(obs[1].context.previousHeads).toEqual(obs[0].heads);
    expect(obs[0].heads.alloc).toBe('str'); // createReadyRun spends the initial points on STR
    expect(await count('training_examples')).toBe(0);
    expect(await count('build_examples')).toBe(0);
    // No global (simulation-trained) model is consulted for a Learning Boss decision.
    const d = (await getPool().query('SELECT predictor FROM boss_decisions WHERE run_id = $1 ORDER BY for_round_number', [runId])).rows;
    for (const x of d) expect(x.predictor.fallbackReason).toMatch(/learning boss/);
  });
  it('the boss plans with a profile forecast: uniform at first, then from this profile’s observations, across runs', async () => {
    const p = await createProfile(getPool(), 'Ada');
    const run1 = await createReadyRun({ maxRounds: 2, mode: 'learning', profileId: p.id });
    await playRound(run1);
    await playRound(run1);
    const d1 = (await getPool().query('SELECT predictor FROM boss_decisions WHERE run_id = $1 ORDER BY for_round_number', [run1])).rows.map((x) => x.predictor.forecast);
    expect(d1.map((f) => f.kind)).toEqual(['profile', 'profile']);
    expect(d1.map((f) => f.observations)).toEqual([0, 1]);
    const u = 1 / 7;
    for (const v of Object.values(d1[0].heads.hands)) expect(v).toBeCloseTo(u, 9); // cold start: rules only
    const run2 = await createReadyRun({ maxRounds: 1, mode: 'learning', profileId: p.id });
    await playRound(run2);
    const f2 = (await getPool().query('SELECT predictor FROM boss_decisions WHERE run_id = $1', [run2])).rows[0].predictor.forecast;
    expect(f2.observations).toBe(2); // the profile remembers the earlier run
    expect(f2.heads.alloc.str).toBeGreaterThan(f2.heads.alloc.dex); // both earlier rounds put points into STR
    // A different profile starts cold again.
    const q = await createProfile(getPool(), 'Bob');
    const run3 = await createReadyRun({ maxRounds: 1, mode: 'learning', profileId: q.id });
    await playRound(run3);
    expect((await getPool().query('SELECT predictor FROM boss_decisions WHERE run_id = $1', [run3])).rows[0].predictor.forecast.observations).toBe(0);
  });
  it('a learning run needs an active profile; start fresh archives (nothing deleted) and starts empty', async () => {
    await expect(withTransaction((c) => createRun(c, { mode: 'learning' }))).rejects.toThrow(/profile/);
    const p = await createProfile(getPool(), 'Ada');
    const runId = await createReadyRun({ maxRounds: 3, mode: 'learning', profileId: p.id });
    await playRound(runId);
    const fresh = await withTransaction((c) => startFresh(c, p.key));
    expect(fresh.key).not.toBe(p.key);
    expect(await loadObservations(getPool(), fresh.id)).toEqual([]);
    expect(await loadObservations(getPool(), p.id)).toHaveLength(1); // history kept
    expect((await getPool().query('SELECT status FROM runs WHERE id = $1', [runId])).rows[0].status).toBe('completed');
    await expect(withTransaction((c) => createRun(c, { mode: 'learning', profileId: p.id }))).rejects.toThrow(/archived/);
  });
  it('profiles never merge: another key cannot touch the run, and each profile sees only its own rounds', async () => {
    const a = (await request(app).post('/api/profiles').send({ name: 'A' })).body;
    const b = (await request(app).post('/api/profiles').send({ name: 'B' })).body;
    const run = await request(app).post('/api/runs').set('X-Profile-Key', a.key).send({ mode: 'learning', maxRounds: 2 });
    expect(run.status).toBe(200);
    const id = run.body.run.id;
    expect(run.body.run.profile_id).toBe(a.id);
    const stolen = await request(app).post(`/api/runs/${id}/allocate`).set('X-Profile-Key', b.key).send({ stat: 'str', points: 2 });
    expect(stolen.status).toBe(400);
    const none = await request(app).post(`/api/runs/${id}/allocate`).send({ stat: 'str', points: 2 });
    expect(none.status).toBe(400);
    const ok = await request(app).post(`/api/runs/${id}/allocate`).set('X-Profile-Key', a.key).send({ stat: 'str', points: 2 });
    expect(ok.status).toBe(200);
    expect((await request(app).get('/api/profiles/me').set('X-Profile-Key', b.key)).body.observations).toBe(0);
    expect((await request(app).get('/api/profiles/me').set('X-Profile-Key', 'not-a-key')).status).toBe(404);
  });
});

describe('local PvP', () => {
  async function pvpRun(maxRounds = 1) {
    const runId = await withTransaction((c) => createRun(c, { mode: 'pvp', maxRounds, config: { names: ['Ann', 'Bo'] } }));
    await allocate(runId, 'str', INITIAL_STAT_POINTS);
    return runId;
  }
  it('both sides are human: Player 2 prepares through the same rules; no boss policy, analysis or learning data', async () => {
    const runId = await pvpRun(1);
    await expect(startRound(runId)).rejects.toThrow(/Player 2/); // P2 has not spent the initial points
    await allocate(runId, 'dex', INITIAL_STAT_POINTS, 'player', undefined, 'boss');
    const roundId = await startRound(runId);
    for (let i = 0; i < 2000; i++) {
      const r = (await getPool().query('SELECT status, pending_choice FROM rounds WHERE id = $1', [roundId])).rows[0];
      if (r.status !== 'in_progress') break;
      const side = r.pending_choice.side;
      const other = side === 'player' ? 'boss' : 'player';
      await expect(submitChoice(roundId, autoAnswer(r.pending_choice), false, other)).rejects.toThrow(/decision/); // turn ownership
      await submitChoice(roundId, autoAnswer(r.pending_choice), false, side);
    }
    const round = (await getPool().query('SELECT status, winner FROM rounds WHERE id = $1', [roundId])).rows[0];
    expect(round.status).toBe('completed');
    expect(['player', 'boss']).toContain(round.winner);
    expect(await count('boss_decisions')).toBe(0);
    expect(await count('boss_analyses')).toBe(0);
    expect(await count('training_examples')).toBe(0);
    expect(await count('profile_observations')).toBe(0);
    const runRow = (await getPool().query('SELECT status, end_reason FROM runs WHERE id = $1', [runId])).rows[0];
    expect(runRow).toEqual({ status: 'completed', end_reason: 'max_rounds' });
    // Both humans got the round rewards by the same rules.
    const golds = (await getPool().query('SELECT side, gold, xp FROM combatants WHERE run_id = $1 ORDER BY side', [runId])).rows;
    expect(golds.every((g) => g.xp > 0)).toBe(true);
  });
  it('PvP pauses for both humans: decisions of both sides appear', async () => {
    const runId = await pvpRun(1);
    await allocate(runId, 'dex', INITIAL_STAT_POINTS, 'player', undefined, 'boss');
    const roundId = await startRound(runId);
    const sides = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const r = (await getPool().query('SELECT status, pending_choice FROM rounds WHERE id = $1', [roundId])).rows[0];
      if (r.status !== 'in_progress') break;
      sides.add(r.pending_choice.side);
      await submitChoice(roundId, autoAnswer(r.pending_choice), false, r.pending_choice.side);
    }
    expect([...sides].sort()).toEqual(['boss', 'player']);
    const sources = (await getPool().query(`SELECT DISTINCT choice_source FROM combat_events e JOIN rounds r ON r.id = e.round_id WHERE r.run_id = $1`, [runId])).rows.map((x) => x.choice_source);
    expect(sources).not.toContain('boss_policy');
  });
  it('PvP over HTTP: Player 2 prepares with ?side=boss and answers with side', async () => {
    const created = await request(app).post('/api/runs').send({ mode: 'pvp', maxRounds: 1, names: ['Ann', 'Bo'] });
    expect(created.status).toBe(200);
    const id = created.body.run.id;
    expect(created.body.run.config.names).toEqual(['Ann', 'Bo']);
    expect((await request(app).post(`/api/runs/${id}/allocate`).send({ stat: 'str', points: 2 })).status).toBe(200);
    expect((await request(app).post(`/api/runs/${id}/allocate?side=boss`).send({ stat: 'def', points: 2 })).status).toBe(200);
    let d = (await request(app).post(`/api/runs/${id}/rounds`)).body;
    for (let i = 0; i < 2000 && d.round.status === 'in_progress'; i++) {
      const p = d.round.pending_choice;
      const body = { ...autoAnswer(p), side: p.side };
      const res = await request(app).post(`/api/rounds/${d.round.id}/choice`).send(body);
      expect(res.status).toBe(200);
      d = res.body;
    }
    expect(d.round.status).toBe('completed');
  });
});
