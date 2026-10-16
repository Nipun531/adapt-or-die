/**
 * RUN SERVICE — create/resume runs and the player's pre-round actions (allocate, buy, equip, end run).
 * All writes are transactional and validated by the game rules in game/equipment.ts; every change is
 * appended to the progression_events ledger together with the resulting state.
 */
import { itemForHistory, requireItem } from '../game/catalog.js';
import { ENGINE_VERSION, INITIAL_STAT_POINTS } from '../game/constants.js';
import { deriveStats } from '../game/derive.js';
import { allocateStat, equip, purchase, RuleError } from '../game/equipment.js';
import { xpToNextLevel } from '../game/formulas.js';
import { initialCombatant } from '../game/progression.js';
import { freshSeed } from '../game/rng.js';
import type { CombatantState, Loadout, Side, StatKey } from '../game/types.js';
import { env } from '../config/env.js';
import { withTransaction, type Db } from '../db/pool.js';
import { rowToCombatant } from './history.js';

export class NotFoundError extends Error {}

export interface CreateRunOptions {
  source?: 'manual' | 'simulation';
  maxRounds?: number;
  seed?: string;
  simulatorVersion?: string | null;
  simulationBatchId?: number | null;
  playerStrategy?: string | null;
  config?: Record<string, unknown>;
}

/**
 * Create a run with both combatants in their initial state — including the INITIAL_STAT_POINTS (2) unallocated
 * stat points each (engine 1.1.0). This is the ONLY place those points are granted, so resuming a run or playing
 * later rounds can never grant them again. The grant is written to the progression ledger (kind 'initial_points').
 * Call inside a transaction (the API and simulator do) so a half-created run can never exist.
 */
export async function createRun(db: Db, opts: CreateRunOptions = {}): Promise<number> {
  const maxRounds = opts.maxRounds ?? env.defaultMaxRounds;
  if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 100) throw new RuleError('maxRounds must be an integer 1..100');
  const r = await db.query(
    `INSERT INTO runs (source, max_rounds, seed, engine_version, simulator_version, simulation_batch_id, player_strategy, config)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [opts.source ?? 'manual', maxRounds, opts.seed ?? freshSeed(), ENGINE_VERSION, opts.simulatorVersion ?? null,
      opts.simulationBatchId ?? null, opts.playerStrategy ?? null, { ...opts.config, initialStatPoints: INITIAL_STAT_POINTS }],
  );
  const runId = r.rows[0].id as number;
  for (const side of ['player', 'boss'] as Side[]) {
    const s = initialCombatant(side);
    await insertCombatant(db, runId, s);
    await logProgression(db, { runId, side, kind: 'initial_points', actor: 'rules', payload: { points: s.statPoints }, stateAfter: s });
  }
  return runId;
}

async function insertCombatant(db: Db, runId: number, s: CombatantState) {
  await db.query(
    `INSERT INTO combatants (run_id, side, level, xp, gold, stat_points, stats, inventory, loadout)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [runId, s.side, s.level, s.xp, s.gold, s.statPoints, s.stats, JSON.stringify(s.inventory), s.loadout],
  );
}

export async function loadCombatant(db: Db, runId: number, side: Side, forUpdate = false): Promise<CombatantState> {
  const r = await db.query(`SELECT * FROM combatants WHERE run_id = $1 AND side = $2 ${forUpdate ? 'FOR UPDATE' : ''}`, [runId, side]);
  if (!r.rows[0]) throw new NotFoundError(`Run ${runId} not found`);
  return rowToCombatant(r.rows[0]);
}

export async function saveCombatant(db: Db, runId: number, s: CombatantState) {
  await db.query(
    `UPDATE combatants SET level=$3, xp=$4, gold=$5, stat_points=$6, stats=$7, inventory=$8, loadout=$9, updated_at=now()
     WHERE run_id=$1 AND side=$2`,
    [runId, s.side, s.level, s.xp, s.gold, s.statPoints, s.stats, JSON.stringify(s.inventory), s.loadout],
  );
}

export async function logProgression(db: Db, e: {
  runId: number; roundId?: number | null; side: Side; kind: string; actor: 'rules' | 'player' | 'boss_policy' | 'agent';
  payload: unknown; stateAfter?: CombatantState | null;
}) {
  await db.query(
    `INSERT INTO progression_events (run_id, round_id, side, kind, actor, payload, state_after) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [e.runId, e.roundId ?? null, e.side, e.kind, e.actor, JSON.stringify(e.payload), e.stateAfter ? JSON.stringify(e.stateAfter) : null],
  );
}

/**
 * Runs created under an older engine (e.g. 1.x before Version 2) are view-only: their rules, catalogue and
 * items differ from the live ones, so continuing them would mix rules inside one run (user-approved, V2_DEMANDS Q-2).
 * Enforced in code only — the run rows are not modified. Ending such a run is still allowed.
 */
export function assertCurrentEngine(run: { id: number; engine_version: string }) {
  if (run.engine_version !== ENGINE_VERSION) {
    throw new RuleError(`Run ${run.id} was created under older rules (engine ${run.engine_version}); it can be viewed but not continued under engine ${ENGINE_VERSION}. Start a new run.`);
  }
}

/** Lock the run and ensure it is in the preparation phase (active, no round in progress). */
export async function lockRunForPrep(db: Db, runId: number, opts: { allowLegacy?: boolean } = {}) {
  const r = await db.query('SELECT * FROM runs WHERE id = $1 FOR UPDATE', [runId]);
  const run = r.rows[0];
  if (!run) throw new NotFoundError(`Run ${runId} not found`);
  if (run.status !== 'active') throw new RuleError(`Run ${runId} is ${run.status}`);
  if (!opts.allowLegacy) assertCurrentEngine(run);
  const ip = await db.query(`SELECT id FROM rounds WHERE run_id = $1 AND status = 'in_progress'`, [runId]);
  if (ip.rowCount) throw new RuleError('A round is in progress — finish it before changing your build');
  return run;
}

type Actor = 'player' | 'agent';

export async function allocate(runId: number, stat: StatKey, points: number, actor: Actor = 'player', db?: Db) {
  const fn = async (c: Db) => {
    await lockRunForPrep(c, runId);
    const s = allocateStat(await loadCombatant(c, runId, 'player', true), stat, points);
    await saveCombatant(c, runId, s);
    await logProgression(c, { runId, side: 'player', kind: 'stat_allocation', actor, payload: { stat, points }, stateAfter: s });
    return s;
  };
  return db ? fn(db) : withTransaction(fn);
}

export async function buy(runId: number, itemId: string, actor: Actor = 'player', db?: Db) {
  const fn = async (c: Db) => {
    await lockRunForPrep(c, runId);
    const s = purchase(await loadCombatant(c, runId, 'player', true), itemId);
    await saveCombatant(c, runId, s);
    await logProgression(c, { runId, side: 'player', kind: 'purchase', actor, payload: { itemId, cost: requireItem(itemId).cost }, stateAfter: s });
    return s;
  };
  return db ? fn(db) : withTransaction(fn);
}

export async function setLoadout(runId: number, loadout: Loadout, actor: Actor = 'player', db?: Db) {
  const fn = async (c: Db) => {
    await lockRunForPrep(c, runId);
    const s = equip(await loadCombatant(c, runId, 'player', true), loadout);
    await saveCombatant(c, runId, s);
    await logProgression(c, { runId, side: 'player', kind: 'equip', actor, payload: { loadout }, stateAfter: s });
    return s;
  };
  return db ? fn(db) : withTransaction(fn);
}

export async function endRun(runId: number) {
  return withTransaction(async (c) => {
    await lockRunForPrep(c, runId, { allowLegacy: true });
    await c.query(`UPDATE runs SET status='completed', end_reason='ended_by_player', ended_at=now(), updated_at=now() WHERE id=$1`, [runId]);
  });
}

/** Combatant state plus derived combat numbers and XP progress, for the UI. */
export function presentCombatant(s: CombatantState, engineVersion: string = ENGINE_VERSION) {
  const lookup = (id: string) => itemForHistory(id, engineVersion); // older runs resolve their own catalogue
  return { ...s, derived: deriveStats(s.stats, s.loadout, lookup), xpToNext: xpToNextLevel(s.level) };
}

export async function getRunView(db: Db, runId: number) {
  const r = await db.query('SELECT * FROM runs WHERE id = $1', [runId]);
  const run = r.rows[0];
  if (!run) throw new NotFoundError(`Run ${runId} not found`);
  const player = await loadCombatant(db, runId, 'player');
  const boss = await loadCombatant(db, runId, 'boss');
  const rounds = await db.query(
    `SELECT id, round_number, status, winner, player_hp_end, boss_hp_end, attack_count, started_at, completed_at
     FROM rounds WHERE run_id = $1 ORDER BY round_number`, [runId]);
  const lastAnalysis = await db.query(
    `SELECT a.analysis, r.round_number FROM boss_analyses a JOIN rounds r ON r.id = a.round_id
     WHERE a.run_id = $1 ORDER BY r.round_number DESC LIMIT 1`, [runId]);
  const lastDecision = await db.query(`SELECT * FROM boss_decisions WHERE run_id = $1 ORDER BY for_round_number DESC LIMIT 1`, [runId]);
  const inProgress = rounds.rows.find((x) => x.status === 'in_progress') ?? null;
  const wins = rounds.rows.filter((x) => x.winner === 'player').length;
  const losses = rounds.rows.filter((x) => x.winner === 'boss').length;
  return {
    run,
    player: presentCombatant(player, run.engine_version),
    boss: presentCombatant(boss, run.engine_version),
    rounds: rounds.rows,
    record: { wins, losses },
    inProgressRoundId: inProgress?.id ?? null,
    lastAnalysis: lastAnalysis.rows[0] ?? null,
    lastDecision: lastDecision.rows[0] ?? null,
  };
}

export async function listRuns(db: Db, opts: { source?: string; limit?: number; offset?: number }) {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const params: unknown[] = [limit, offset];
  let where = '';
  if (opts.source) {
    params.push(opts.source);
    where = 'WHERE r.source = $3';
  }
  const res = await db.query(
    `SELECT r.id, r.source, r.status, r.end_reason, r.max_rounds, r.player_strategy, r.simulation_batch_id, r.created_at,
       (SELECT count(*)::int FROM rounds x WHERE x.run_id = r.id AND x.status='completed') AS rounds_completed,
       (SELECT count(*)::int FROM rounds x WHERE x.run_id = r.id AND x.winner='player') AS player_wins,
       (SELECT count(*)::int FROM rounds x WHERE x.run_id = r.id AND x.winner='boss') AS boss_wins
     FROM runs r ${where} ORDER BY r.id DESC LIMIT $1 OFFSET $2`, params);
  const total = await db.query(`SELECT count(*)::int AS n FROM runs r ${opts.source ? 'WHERE r.source = $1' : ''}`, opts.source ? [opts.source] : []);
  return { runs: res.rows, total: total.rows[0].n };
}
