/**
 * API integration tests (supertest against the Express app + real PostgreSQL test DB):
 * validation/error codes, full manual play through HTTP, player choice prompts, simulation batches
 * launched from the API, and honest ML status / refusal to train on a tiny dataset.
 */
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/api/app.js';
import { closePool, getPool } from '../../src/db/pool.js';
import { stopInferenceWorker } from '../../src/ml/predictor.js';
import { resetTables, useTestDatabase } from '../helpers/db.js';

const app = createApp();

beforeAll(useTestDatabase);
beforeEach(resetTables);
afterAll(async () => {
  stopInferenceWorker();
  await closePool();
});

describe('basic endpoints', () => {
  it('health and catalog', async () => {
    const hres = await request(app).get('/api/health');
    expect(hres.status).toBe(200);
    expect(hres.body.ok).toBe(true);
    const c = await request(app).get('/api/catalog');
    expect(c.body.items).toHaveLength(24);
    expect(c.body.legacyItems.map((i: { id: string }) => i.id)).toEqual(["axe"]);
    expect(c.body.rules.rewards).toEqual({ xpWin: 50, xpLoss: 30, goldWin: 10, goldLoss: 5, goldLevelUp: 20 });
    expect(c.body.rules.xpCurve[1]).toEqual({ level: 2, xpToNext: 112 });
  });

  it('validation and error codes', async () => {
    expect((await request(app).get('/api/runs/999')).status).toBe(404);
    expect((await request(app).get('/api/runs/abc')).status).toBe(400);
    expect((await request(app).get('/api/nope')).status).toBe(404);
    const run = (await request(app).post('/api/runs').send({ maxRounds: 3, seed: 'api-1' })).body;
    const id = run.run.id;
    expect(run.player.gold).toBe(0);
    expect(run.player.statPoints).toBe(2);
    expect((await request(app).post(`/api/runs/${id}/allocate`).send({ stat: 'str', points: 3 })).body.error).toMatch(/Not enough stat points/);
    expect((await request(app).post(`/api/runs/${id}/allocate`).send({ stat: 'str', points: -1 })).status).toBe(400);
    expect((await request(app).post(`/api/runs/${id}/allocate`).send({ stat: 'str', points: 1.5 })).status).toBe(400);
    expect((await request(app).post(`/api/runs/${id}/allocate`).send({ stat: 'mana', points: 1 })).status).toBe(400);
    expect((await request(app).post(`/api/runs/${id}/buy`).send({ itemId: 'bow' })).body.error).toMatch(/Not enough gold/);
    expect((await request(app).post(`/api/runs/${id}/loadout`).send({ hand1: 'bow', hand2: null, armour: null })).body.error).toMatch(/not owned/);
    expect((await request(app).post(`/api/runs/${id}/buy`).set('Content-Type', 'application/json').send('{bad')).status).toBe(400);
    expect((await request(app).post('/api/runs').send({ maxRounds: 0 })).status).toBe(400);
  });
});

describe('manual play over HTTP', () => {
  it('plays a full 3-round run with rewards, analysis and boss decisions', async () => {
    const id = (await request(app).post('/api/runs').send({ maxRounds: 3, seed: 'api-play' })).body.run.id;
    await request(app).post(`/api/runs/${id}/allocate`).send({ stat: 'dex', points: 2 });
    for (let n = 1; n <= 3; n++) {
      const r = await request(app).post(`/api/runs/${id}/rounds`);
      expect(r.status).toBe(200);
      expect(r.body.round.round_number).toBe(n);
      expect(r.body.round.status).toBe('completed');
      expect(r.body.events.length).toBeGreaterThan(0);
      expect(r.body.analysis).not.toBeNull();
      expect(r.body.decision.predictor.kind).toBe('fallback');
      if (n === 1) {
        // spend round-1 gold on a Knuckle (3g) and equip it — legal for both win (10g) and loss (5g)
        expect((await request(app).post(`/api/runs/${id}/buy`).send({ itemId: 'knuckle' })).status).toBe(200);
        const lo = await request(app).post(`/api/runs/${id}/loadout`).send({ hand1: 'knuckle', hand2: null, armour: null });
        expect(lo.body.player.loadout.hand1).toBe('knuckle');
      }
    }
    const view = (await request(app).get(`/api/runs/${id}`)).body;
    expect(view.run.status).toBe('completed');
    expect(view.rounds).toHaveLength(3);
    expect(view.record.wins + view.record.losses).toBe(3);
    expect((await request(app).post(`/api/runs/${id}/rounds`)).status).toBe(400);
    const prog = (await request(app).get(`/api/runs/${id}/progression`)).body.events;
    expect(prog.some((e: any) => e.kind === 'purchase' && e.actor === 'player')).toBe(true);
    const list = (await request(app).get('/api/runs?source=manual')).body;
    expect(list.total).toBe(1);
  });

  it('prompts a Ranged+Melee player for choices and validates them', async () => {
    const id = (await request(app).post('/api/runs').send({ maxRounds: 2, seed: 'api-choice' })).body.run.id;
    // TEST FIXTURE: grant gold directly so a bow + sword are affordable in round 1.
    await getPool().query(`UPDATE combatants SET gold = 25 WHERE run_id = $1 AND side = 'player'`, [id]);
    await request(app).post(`/api/runs/${id}/allocate`).send({ stat: 'dex', points: 2 });
    await request(app).post(`/api/runs/${id}/buy`).send({ itemId: 'bow' });
    await request(app).post(`/api/runs/${id}/buy`).send({ itemId: 'sword' });
    await request(app).post(`/api/runs/${id}/loadout`).send({ hand1: 'bow', hand2: 'sword', armour: null });
    const r = (await request(app).post(`/api/runs/${id}/rounds`)).body;
    expect(r.round.status).toBe('in_progress');
    expect(r.round.pending_choice.options).toEqual(['ranged', 'melee']);
    expect((await request(app).post(`/api/runs/${id}/buy`).send({ itemId: 'knuckle' })).body.error).toMatch(/in progress/);
    expect((await request(app).post(`/api/rounds/${r.round.id}/choice`).send({ mode: 'unarmed' })).status).toBe(400);
    const done = (await request(app).post(`/api/rounds/${r.round.id}/choice`).send({ mode: 'ranged', repeat: true })).body;
    expect(done.round.status).toBe('completed');
  });
});

describe('simulations and ML over HTTP', () => {
  it('launches a batch, reports progress to completion, and ML status reflects the data', async () => {
    const strategies = (await request(app).get('/api/simulations/strategies')).body.strategies;
    expect(strategies.length).toBeGreaterThanOrEqual(6);
    const post = await request(app).post('/api/simulations').send({ runs: 3, maxRounds: 3, seed: 'api-sim', strategies: ['archer', 'hybrid', 'random'] });
    expect(post.status).toBe(202);
    expect((await request(app).post('/api/simulations').send({ runs: 1, maxRounds: 1 })).status).toBe(409);
    let b = post.body;
    for (let i = 0; i < 100 && !['completed', 'failed'].includes(b.status); i++) {
      await new Promise((r) => setTimeout(r, 200));
      b = (await request(app).get(`/api/simulations/${b.id}`)).body;
    }
    expect(b.status).toBe('completed');
    expect(b.rounds_completed).toBe(9);

    const st = (await request(app).get('/api/ml/status')).body;
    expect(st.dataset.valid + st.dataset.invalid).toBe(6);
    expect(st.activeModel).toBeNull();
    expect(st.latestDecision.kind).toBe('fallback');
    expect(st.decisionUsage.fallback).toBe(9);

    // Tiny dataset → the pipeline refuses to train (honest), and activation of unknown models fails.
    const t = (await request(app).post('/api/ml/train').send({})).body;
    expect(t.trained).toBe(false);
    expect(t.error).toMatch(/too small|single-class/);
    expect((await request(app).post('/api/ml/activate').send({ version: 'nope' })).status).toBe(400);
  });
});

describe('Armory endpoints (V2 Phase 7c)', () => {
  const counts = async () => (await getPool().query(
    `SELECT (SELECT count(*) FROM progression_events)::int AS ev, (SELECT gold FROM combatants WHERE side = 'player' LIMIT 1) AS gold`)).rows[0];

  it('preview returns derived numbers for a hypothetical loadout and writes nothing', async () => {
    const id = (await request(app).post('/api/runs').send({})).body.run.id;
    await getPool().query(`UPDATE combatants SET gold = 20 WHERE run_id = $1 AND side = 'player'`, [id]);
    const before = await counts();
    const p = await request(app).post(`/api/runs/${id}/preview`).send({ loadout: { hand1: 'sword', hand2: null, armour: null }, allocation: { str: 1 } });
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ purchases: ['sword'], cost: 10, affordable: true, problem: null });
    expect(p.body.preview.netAtk).toBeCloseTo((20 + 3) * (1 + 0.25 * 4));
    expect(p.body.current.netAtk).toBe(20);
    const bad = await request(app).post(`/api/runs/${id}/preview`).send({ loadout: { hand1: 'sword', hand2: 'mace', armour: null } });
    expect(bad.body.problem).toMatch(/Illegal hand combination/);
    expect(bad.body.preview).toBeNull();
    expect(await counts()).toEqual(before);
  });

  it('buy with a loadout buys and equips in one step; an illegal loadout buys nothing', async () => {
    const id = (await request(app).post('/api/runs').send({})).body.run.id;
    await getPool().query(`UPDATE combatants SET gold = 30 WHERE run_id = $1 AND side = 'player'`, [id]);
    const ok = await request(app).post(`/api/runs/${id}/buy`).send({ itemId: 'sword', loadout: { hand1: 'sword', hand2: null, armour: null } });
    expect(ok.status).toBe(200);
    expect(ok.body.player).toMatchObject({ gold: 20, inventory: ['sword'], loadout: { hand1: 'sword' } });
    const bad = await request(app).post(`/api/runs/${id}/buy`).send({ itemId: 'mace', loadout: { hand1: 'sword', hand2: 'mace', armour: null } });
    expect(bad.status).toBe(400);
    const v = (await request(app).get(`/api/runs/${id}`)).body;
    expect(v.player).toMatchObject({ gold: 20, inventory: ['sword'] });
  });
});
