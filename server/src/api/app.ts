/**
 * EXPRESS APP — the REST API used by the web client. The server is authoritative for every rule:
 * inputs are validated here (zod) for shape and again by the game rules (RuleError) for legality.
 *
 * Error mapping: zod/RuleError/MlError/bad input → 400, NotFoundError → 404, busy → 409, anything else → 500
 * with an actionable message (database errors are explained without exposing credentials).
 * createApp() has no side effects, so tests can mount it with supertest.
 */
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { z, ZodError } from 'zod';
import { env, REPO_ROOT } from '../config/env.js';
import { explainDbError, getPool, withTransaction } from '../db/pool.js';
import { ITEMS, ITEMS_V1 } from '../game/catalog.js';
import * as C from '../game/constants.js';
import { RuleError } from '../game/equipment.js';
import { xpToNextLevel } from '../game/formulas.js';
import { STAT_KEYS } from '../game/types.js';
import { exportDataset } from '../ml/dataset.js';
import { buildMissingExamples } from '../ml/examples.js';
import { activateModel, deactivateModels, listModels, MlError, mlStatus, trainModel } from '../ml/training.js';
import { getRoundDetail, startRound, submitChoice } from '../services/rounds.js';
import { LIVE_RULES } from '../game/rules.js';
import { allocate, buy, buyAndEquip, buySupplies, createRun, endRun, getRunView, listRuns, NotFoundError, previewBuild, setLoadout } from '../services/runs.js';
import { AGENTS, SIMULATOR_VERSION } from '../sim/agents.js';
import { BATCH_LIMITS, createBatch, executeBatch, getBatch, listBatches, normalizeConfig } from '../sim/runner.js';

export class BusyError extends Error {}

type Handler = (req: Request, res: Response) => Promise<unknown>;
/** Wrap an async handler: JSON-encode its return value, forward errors to the error middleware. */
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).then((body) => { if (!res.headersSent) res.json(body); }).catch(next);
};

const idParam = (req: Request, name = 'id') => {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n) || n <= 0) throw new RuleError(`Invalid ${name}`);
  return n;
};

const slot = z.string().min(1).max(40).nullable();
const loadoutSchema = z.object({ hand1: slot, hand2: slot, armour: slot }).strict();
const schemas = {
  buy: z.object({ itemId: z.string().min(1).max(40), loadout: loadoutSchema.optional() }).strict(),
  preview: z.object({
    allocation: z.object({ hp: z.number().int().min(0).max(50), str: z.number().int().min(0).max(50), def: z.number().int().min(0).max(50), dex: z.number().int().min(0).max(50) }).partial().strict().optional(),
    loadout: loadoutSchema.optional(),
  }).strict(),
  createRun: z.object({ maxRounds: z.number().int().min(1).max(100).optional(), seed: z.string().min(1).max(100).optional() }).strict(),
  allocate: z.object({ stat: z.enum(STAT_KEYS as [string, ...string[]]), points: z.number().int().positive() }).strict(),
  loadout: z.object({ hand1: slot, hand2: slot, armour: slot }).strict(),
  // Exactly one of mode / defense / stim (it must match the pending decision; the engine re-checks).
  choice: z.object({
    mode: z.enum(['melee', 'ranged', 'unarmed']).optional(),
    repeat: z.boolean().optional(),
    defense: z.enum(['block', 'dodge']).optional(),
    stim: z.boolean().optional(),
  }).strict().refine((b) => [b.mode, b.defense, b.stim].filter((x) => x !== undefined).length === 1, 'Send exactly one of mode, defense or stim'),
  supplies: z.object({ action: z.enum(['buy_stim', 'upgrade_slots', 'upgrade_effectiveness']) }).strict(),
  simulation: z.object({
    runs: z.number().int().min(1).max(BATCH_LIMITS.maxRuns),
    maxRounds: z.number().int().min(1).max(BATCH_LIMITS.maxRounds),
    strategies: z.array(z.string()).optional(),
    seed: z.string().max(100).optional(),
  }).strict(),
  train: z.object({ activate: z.boolean().optional() }).strict(),
  activate: z.object({ version: z.string().min(1).nullable() }).strict(),
};

/** One simulation batch at a time per server process (keeps the DB and CPU responsive for play). */
let runningBatch: number | null = null;

export function createApp() {
  const app = express();
  app.use(cors({ origin: env.clientOrigin }));
  app.use(express.json({ limit: '100kb' }));

  // ---------- health + static game data ----------
  app.get('/api/health', h(async () => {
    let database = 'ok';
    try {
      await getPool().query('SELECT 1 FROM runs LIMIT 1');
    } catch (e) {
      database = explainDbError(e);
    }
    return { ok: database === 'ok', database, engineVersion: C.ENGINE_VERSION, simulatorVersion: SIMULATOR_VERSION };
  }));

  app.get('/api/catalog', h(async () => ({
    items: ITEMS,
    // Names for ids that only exist in older engines (e.g. the Axe), so historical runs still display correctly.
    legacyItems: ITEMS_V1.filter((i) => !ITEMS.some((x) => x.id === i.id)),
    rules: {
      engineVersion: C.ENGINE_VERSION,
      baseStats: C.BASE_STATS, levelUpIncrease: C.LEVEL_UP_INCREASE, statAllocationIncrease: C.STAT_ALLOCATION_INCREASE,
      statPointsPerLevel: C.STAT_POINTS_PER_LEVEL, initialStatPoints: C.INITIAL_STAT_POINTS, rewards: { xpWin: C.XP_WIN, xpLoss: C.XP_LOSS, goldWin: C.GOLD_WIN, goldLoss: C.GOLD_LOSS, goldLevelUp: C.GOLD_LEVEL_UP },
      xpCurve: Array.from({ length: 10 }, (_, i) => ({ level: i + 1, xpToNext: xpToNextLevel(i + 1) })),
      dexBonusThresholds: C.DEX_BONUS_THRESHOLDS, mitigationRoll: [C.MITIGATION_ROLL_MIN, C.MITIGATION_ROLL_MAX],
      defaultMaxRounds: env.defaultMaxRounds,
      startingGold: C.STARTING_GOLD,
      /** V3 combat numbers (block/dodge/counter/stun/stims/turn limit) for help text; null under a pre-V3 engine. */
      combat: LIVE_RULES.v3,
    },
  })));

  // ---------- runs + preparation ----------
  app.get('/api/runs', h(async (req) => listRuns(getPool(), {
    source: typeof req.query.source === 'string' && ['manual', 'simulation'].includes(req.query.source) ? req.query.source : undefined,
    limit: Number(req.query.limit) || undefined,
    offset: Number(req.query.offset) || undefined,
  })));
  app.post('/api/runs', h(async (req) => {
    const body = schemas.createRun.parse(req.body ?? {});
    const id = await withTransaction((c) => createRun(c, { source: 'manual', ...body }));
    return getRunView(getPool(), id);
  }));
  app.get('/api/runs/:id', h(async (req) => getRunView(getPool(), idParam(req))));
  app.post('/api/runs/:id/end', h(async (req) => {
    await endRun(idParam(req));
    return getRunView(getPool(), idParam(req));
  }));
  app.post('/api/runs/:id/allocate', h(async (req) => {
    const b = schemas.allocate.parse(req.body);
    await allocate(idParam(req), b.stat as (typeof STAT_KEYS)[number], b.points);
    return getRunView(getPool(), idParam(req));
  }));
  app.post('/api/runs/:id/buy', h(async (req) => {
    const b = schemas.buy.parse(req.body);
    if (b.loadout) await buyAndEquip(idParam(req), b.itemId, b.loadout);
    else await buy(idParam(req), b.itemId);
    return getRunView(getPool(), idParam(req));
  }));
  app.post('/api/runs/:id/supplies', h(async (req) => {
    await buySupplies(idParam(req), schemas.supplies.parse(req.body).action);
    return getRunView(getPool(), idParam(req));
  }));
  app.post('/api/runs/:id/loadout', h(async (req) => {
    await setLoadout(idParam(req), schemas.loadout.parse(req.body));
    return getRunView(getPool(), idParam(req));
  }));
  // Pure preview for the Armory: derived numbers for a hypothetical allocation/loadout. Writes nothing.
  app.post('/api/runs/:id/preview', h(async (req) => previewBuild(getPool(), idParam(req), schemas.preview.parse(req.body ?? {}))));
  app.get('/api/runs/:id/progression', h(async (req) => {
    const r = await getPool().query('SELECT * FROM progression_events WHERE run_id = $1 ORDER BY id', [idParam(req)]);
    return { events: r.rows };
  }));

  // ---------- rounds ----------
  app.post('/api/runs/:id/rounds', h(async (req) => getRoundDetail(getPool(), await startRound(idParam(req)))));
  app.get('/api/rounds/:id', h(async (req) => getRoundDetail(getPool(), idParam(req))));
  app.post('/api/rounds/:id/choice', h(async (req) => {
    const b = schemas.choice.parse(req.body);
    await submitChoice(idParam(req), b);
    return getRoundDetail(getPool(), idParam(req));
  }));

  // ---------- simulations ----------
  app.get('/api/simulations/strategies', h(async () => ({
    strategies: Object.values(AGENTS).map((a) => ({ name: a.name, description: a.description })),
    limits: BATCH_LIMITS, simulatorVersion: SIMULATOR_VERSION, running: runningBatch,
  })));
  app.get('/api/simulations', h(async (req) => ({ batches: await listBatches(Number(req.query.limit) || 25), running: runningBatch })));
  app.get('/api/simulations/:id', h(async (req) => {
    const b = await getBatch(idParam(req));
    if (!b) throw new NotFoundError(`Simulation batch ${req.params.id} not found`);
    return b;
  }));
  app.post('/api/simulations', h(async (req, res) => {
    if (runningBatch !== null) throw new BusyError(`Simulation batch ${runningBatch} is still running`);
    const config = normalizeConfig(schemas.simulation.parse(req.body));
    const batchId = await createBatch(config);
    runningBatch = batchId;
    // Runs in the background; progress is persisted to simulation_batches and polled by the UI.
    executeBatch(batchId)
      .catch(async (e) => {
        console.error(`[sim] batch ${batchId} crashed:`, e);
        await getPool().query(`UPDATE simulation_batches SET status='failed', finished_at=now(), errors = errors || $2::jsonb WHERE id=$1`,
          [batchId, JSON.stringify([{ message: String(e?.message ?? e) }])]).catch(() => undefined);
      })
      .finally(() => { runningBatch = null; });
    res.status(202);
    return getBatch(batchId);
  }));

  // ---------- ML ----------
  app.get('/api/ml/status', h(async (req) => mlStatus(getPool(), { pingPython: req.query.ping === '1' })));
  app.get('/api/ml/models', h(async () => ({ models: await listModels(getPool()) })));
  app.post('/api/ml/build-dataset', h(async () => buildMissingExamples(getPool())));
  app.post('/api/ml/export', h(async () => exportDataset(getPool())));
  app.post('/api/ml/train', h(async (req) => {
    if (runningBatch !== null) throw new BusyError('Wait for the running simulation batch to finish before training');
    return trainModel(getPool(), { activate: schemas.train.parse(req.body ?? {}).activate ?? false });
  }));
  app.post('/api/ml/activate', h(async (req) => {
    const { version } = schemas.activate.parse(req.body);
    if (version === null) await deactivateModels(getPool());
    else await activateModel(getPool(), version);
    return mlStatus(getPool());
  }));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API endpoint' }));

  // Serve the built client (npm run build) if present, so `npm start` alone hosts the whole game.
  const dist = path.join(REPO_ROOT, 'client', 'dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') });
    }
    if (err instanceof RuleError || err instanceof MlError) return res.status(400).json({ error: err.message });
    if (err instanceof NotFoundError) return res.status(404).json({ error: err.message });
    if (err instanceof BusyError) return res.status(409).json({ error: err.message });
    if (err instanceof SyntaxError && 'body' in (err as object)) return res.status(400).json({ error: 'Malformed JSON body' });
    const msg = (err as Error)?.message ?? '';
    if (/^(runs|maxRounds|seed) must|Unknown strategy/.test(msg)) return res.status(400).json({ error: msg });
    console.error('[api] unexpected error:', err);
    return res.status(500).json({ error: explainDbError(err) });
  });
  return app;
}
