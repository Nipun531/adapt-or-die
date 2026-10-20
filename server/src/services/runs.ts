/**
 * RUN SERVICE — create/resume runs and the player's pre-round actions (allocate, buy, equip, end run).
 * All writes are transactional and validated by the game rules in game/equipment.ts; every change is
 * appended to the progression_events ledger together with the resulting state.
 */
import { itemForHistory, requireItem } from '../game/catalog.js';
import { ENGINE_VERSION, INITIAL_STAT_POINTS } from '../game/constants.js';
import { deriveStats } from '../game/derive.js';
import { allocateStat, buySupply, equip, loadoutProblem, purchase, RuleError, supplyCost, supplyProblem, type SupplyAction } from '../game/equipment.js';
import { LIVE_RULES } from '../game/rules.js';
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
  /** V4 game mode (default 'prepared' = the simulation-informed boss). */
  mode?: GameMode;
  /** Learning mode only: the profile whose boss learns (must be active). */
  profileId?: number | null;
}

/** V4 game modes (docs/V4_IMPLEMENTATION_PLAN.md §3). PvP: side 'player' = Player 1, side 'boss' = Player 2. */
export type GameMode = 'prepared' | 'learning' | 'pvp';
export const GAME_MODES: GameMode[] = ['prepared', 'learning', 'pvp'];

/**
 * Create a run with both combatants in their initial state — including the INITIAL_STAT_POINTS (2) unallocated
 * stat points each (engine 1.1.0). This is the ONLY place those points are granted, so resuming a run or playing
 * later rounds can never grant them again. The grant is written to the progression ledger (kind 'initial_points').
 * Call inside a transaction (the API and simulator do) so a half-created run can never exist.
 */
export async function createRun(db: Db, opts: CreateRunOptions = {}): Promise<number> {
  const maxRounds = opts.maxRounds ?? env.defaultMaxRounds;
  if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 100) throw new RuleError('maxRounds must be an integer 1..100');
  const mode = opts.mode ?? 'prepared';
  if (!GAME_MODES.includes(mode)) throw new RuleError(`Unknown mode "${mode}"`);
  if (mode === 'learning') {
    if (!opts.profileId) throw new RuleError('A Learning Boss run needs a learning profile');
    const p = await db.query('SELECT status FROM learning_profiles WHERE id = $1', [opts.profileId]);
    if (!p.rows[0]) throw new NotFoundError('Learning profile not found');
    if (p.rows[0].status !== 'active') throw new RuleError('This learning profile was archived; start a fresh one');
  } else if (opts.profileId) throw new RuleError('Only Learning Boss runs belong to a learning profile');
  if (mode === 'pvp' && (opts.source ?? 'manual') !== 'manual') throw new RuleError('PvP runs are played by two humans');
  const r = await db.query(
    `INSERT INTO runs (source, max_rounds, seed, engine_version, simulator_version, simulation_batch_id, player_strategy, config, mode, profile_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [opts.source ?? 'manual', maxRounds, opts.seed ?? freshSeed(), ENGINE_VERSION, opts.simulatorVersion ?? null,
      opts.simulationBatchId ?? null, opts.playerStrategy ?? null, { ...opts.config, initialStatPoints: INITIAL_STAT_POINTS }, mode, opts.profileId ?? null],
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
    `INSERT INTO combatants (run_id, side, level, xp, gold, stat_points, stats, inventory, loadout, supplies)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [runId, s.side, s.level, s.xp, s.gold, s.statPoints, s.stats, JSON.stringify(s.inventory), s.loadout, s.supplies ? JSON.stringify(s.supplies) : null],
  );
}

export async function loadCombatant(db: Db, runId: number, side: Side, forUpdate = false): Promise<CombatantState> {
  const r = await db.query(`SELECT * FROM combatants WHERE run_id = $1 AND side = $2 ${forUpdate ? 'FOR UPDATE' : ''}`, [runId, side]);
  if (!r.rows[0]) throw new NotFoundError(`Run ${runId} not found`);
  return rowToCombatant(r.rows[0]);
}

export async function saveCombatant(db: Db, runId: number, s: CombatantState) {
  await db.query(
    `UPDATE combatants SET level=$3, xp=$4, gold=$5, stat_points=$6, stats=$7, inventory=$8, loadout=$9, supplies=$10, updated_at=now()
     WHERE run_id=$1 AND side=$2`,
    [runId, s.side, s.level, s.xp, s.gold, s.statPoints, s.stats, JSON.stringify(s.inventory), s.loadout, s.supplies ? JSON.stringify(s.supplies) : null],
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

/** Who may change a side between rounds: always the player side; side 'boss' only in PvP (it is Player 2). */
function assertPrepSide(run: { mode?: string }, side: Side) {
  if (side === 'boss' && run.mode !== 'pvp') throw new RuleError('Only the boss prepares its own side (PvP excepted)');
}

export async function allocate(runId: number, stat: StatKey, points: number, actor: Actor = 'player', db?: Db, side: Side = 'player') {
  const fn = async (c: Db) => {
    assertPrepSide(await lockRunForPrep(c, runId), side);
    const s = allocateStat(await loadCombatant(c, runId, side, true), stat, points);
    await saveCombatant(c, runId, s);
    await logProgression(c, { runId, side, kind: 'stat_allocation', actor, payload: { stat, points }, stateAfter: s });
    return s;
  };
  return db ? fn(db) : withTransaction(fn);
}

export async function buy(runId: number, itemId: string, actor: Actor = 'player', db?: Db, side: Side = 'player') {
  const fn = async (c: Db) => {
    assertPrepSide(await lockRunForPrep(c, runId), side);
    const s = purchase(await loadCombatant(c, runId, side, true), itemId);
    await saveCombatant(c, runId, s);
    await logProgression(c, { runId, side, kind: 'purchase', actor, payload: { itemId, cost: requireItem(itemId).cost }, stateAfter: s });
    return s;
  };
  return db ? fn(db) : withTransaction(fn);
}

/**
 * Buy an item and equip a loadout that uses it, in ONE transaction (the Armory's "buy & equip").
 * Both steps go through the same rules as separate calls; if the loadout is illegal nothing is bought.
 */
export async function buyAndEquip(runId: number, itemId: string, loadout: Loadout, actor: Actor = 'player', side: Side = 'player') {
  return withTransaction(async (c) => {
    assertPrepSide(await lockRunForPrep(c, runId), side);
    const bought = purchase(await loadCombatant(c, runId, side, true), itemId);
    const s = equip(bought, loadout);
    await saveCombatant(c, runId, s);
    await logProgression(c, { runId, side, kind: 'purchase', actor, payload: { itemId, cost: requireItem(itemId).cost }, stateAfter: bought });
    await logProgression(c, { runId, side, kind: 'equip', actor, payload: { loadout }, stateAfter: s });
    return s;
  });
}

/**
 * PURE PREVIEW (writes nothing): the player's derived combat numbers for a hypothetical stat allocation and/or
 * loadout, so the client can show "Net ATK 40.3 → 49.5" without computing any rule itself. Items not owned yet are
 * treated as bought; the result says what that would cost, whether it is affordable and whether the loadout is legal.
 */
export async function previewBuild(db: Db, runId: number, req: { allocation?: Partial<Record<StatKey, number>>; loadout?: Loadout }, side: Side = 'player') {
  if (side === 'boss') assertPrepSide((await db.query('SELECT mode FROM runs WHERE id = $1', [runId])).rows[0] ?? {}, side);
  const now = await loadCombatant(db, runId, side);
  let s = now;
  for (const [stat, n] of Object.entries(req.allocation ?? {})) if (n) s = allocateStat(s, stat as StatKey, n);
  const loadout = req.loadout ?? s.loadout;
  const ids = [loadout.hand1, loadout.hand2, loadout.armour].filter((x): x is string => x !== null);
  for (const id of ids) requireItem(id); // unknown ids → error
  const purchases = ids.filter((id) => !now.inventory.includes(id));
  const cost = purchases.reduce((a, id) => a + requireItem(id).cost, 0);
  const problem = loadoutProblem(loadout, [...now.inventory, ...purchases]);
  return {
    current: deriveStats(now.stats, now.loadout),
    preview: problem ? null : deriveStats(s.stats, loadout),
    stats: s.stats, loadout, purchases, cost, affordable: cost <= now.gold, problem,
  };
}

/** Progression-ledger kind of each supply action. */
export const SUPPLY_LEDGER_KIND: Record<SupplyAction, string> = {
  buy_stim: 'stim_purchase',
  upgrade_slots: 'stim_slot_upgrade',
  upgrade_effectiveness: 'stim_effectiveness_upgrade',
};

/** Buy a healing stim or a stim upgrade (V3; docs/V3_DEMANDS.md §6). Between rounds only, like every purchase. */
export async function buySupplies(runId: number, action: SupplyAction, actor: Actor = 'player', db?: Db, side: Side = 'player') {
  const fn = async (c: Db) => {
    assertPrepSide(await lockRunForPrep(c, runId), side);
    const before = await loadCombatant(c, runId, side, true);
    const cost = supplyCost(before, action);
    const s = buySupply(before, action);
    await saveCombatant(c, runId, s);
    await logProgression(c, { runId, side, kind: SUPPLY_LEDGER_KIND[action], actor, payload: { action, cost }, stateAfter: s });
    return s;
  };
  return db ? fn(db) : withTransaction(fn);
}

export async function setLoadout(runId: number, loadout: Loadout, actor: Actor = 'player', db?: Db, side: Side = 'player') {
  const fn = async (c: Db) => {
    assertPrepSide(await lockRunForPrep(c, runId), side);
    const s = equip(await loadCombatant(c, runId, side, true), loadout);
    await saveCombatant(c, runId, s);
    await logProgression(c, { runId, side, kind: 'equip', actor, payload: { loadout }, stateAfter: s });
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
  // V3: stim prices, why an action is not possible right now, and the current heal size — all from the rules.
  const supplyInfo = s.supplies && LIVE_RULES.v3
    ? {
      healFraction: LIVE_RULES.v3.stim.healBase + LIVE_RULES.v3.stim.healPerUpgrade * s.supplies.effectiveness,
      actions: Object.fromEntries((['buy_stim', 'upgrade_slots', 'upgrade_effectiveness'] as SupplyAction[]).map((a) => [a, { cost: supplyCost(s, a), problem: supplyProblem(s, a) }])),
    }
    : null;
  return { ...s, derived: deriveStats(s.stats, s.loadout, lookup), xpToNext: xpToNextLevel(s.level), supplyInfo };
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

export async function listRuns(db: Db, opts: { source?: string; mode?: string; limit?: number; offset?: number }) {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const conds: string[] = [];
  const filters: unknown[] = [];
  if (opts.source) { filters.push(opts.source); conds.push(`r.source = $${filters.length + 2}`); }
  if (opts.mode) { filters.push(opts.mode); conds.push(`r.mode = $${filters.length + 2}`); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const res = await db.query(
    `SELECT r.id, r.source, r.mode, r.profile_id, r.status, r.end_reason, r.max_rounds, r.engine_version, r.player_strategy, r.simulation_batch_id, r.created_at,
       r.config->'names' AS names,
       (SELECT count(*)::int FROM rounds x WHERE x.run_id = r.id AND x.status='completed') AS rounds_completed,
       (SELECT count(*)::int FROM rounds x WHERE x.run_id = r.id AND x.winner='player') AS player_wins,
       (SELECT count(*)::int FROM rounds x WHERE x.run_id = r.id AND x.winner='boss') AS boss_wins
     FROM runs r ${where} ORDER BY r.id DESC LIMIT $1 OFFSET $2`, [limit, offset, ...filters]);
  const total = await db.query(`SELECT count(*)::int AS n FROM runs r ${where.replace(/\$(\d+)/g, (_, n) => `$${Number(n) - 2}`)}`, filters);
  return { runs: res.rows, total: total.rows[0].n };
}
