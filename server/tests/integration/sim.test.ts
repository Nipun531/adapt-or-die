/**
 * Simulation integration tests (real PostgreSQL): batches run through the normal services, grow the
 * dataset with source='simulation' provenance, are reproducible from the seed, and never overwrite history.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, getPool } from '../../src/db/pool.js';
import { isLegalLoadout } from '../../src/game/equipment.js';
import { stopInferenceWorker } from '../../src/ml/predictor.js';
import { adaptiveStyle, SIMULATOR_VERSION, STRATEGY_NAMES } from '../../src/sim/agents.js';
import { createBatch, executeBatch, getBatch, normalizeConfig, playSimulatedRun } from '../../src/sim/runner.js';
import { playInMemoryRun } from '../../src/sim/balance.js';
import { LIVE_RULES } from '../../src/game/rules.js';
import type { CombatEvent } from '../../src/game/combat.js';
import { loadEvents } from '../../src/services/history.js';
import { resetTables, useTestDatabase } from '../helpers/db.js';

beforeAll(useTestDatabase);
beforeEach(resetTables);
afterAll(async () => {
  stopInferenceWorker();
  await closePool();
});

/** Outcome fingerprint of every round in a batch, in run order. */
async function fingerprint(batchId: number) {
  const r = await getPool().query(
    `SELECT r.player_strategy, x.round_number, x.seed, x.winner, x.player_hp_end, x.boss_hp_end, x.attack_count, x.player_snapshot, x.boss_snapshot
     FROM runs r JOIN rounds x ON x.run_id = r.id WHERE r.simulation_batch_id = $1 ORDER BY r.id, x.round_number`, [batchId]);
  return r.rows;
}

describe('simulation batches', () => {
  it('runs every strategy, records provenance and appends training examples', async () => {
    const config = normalizeConfig({ runs: STRATEGY_NAMES.length, maxRounds: 4, seed: 'sim-test-a' });
    const batchId = await createBatch(config);
    const progress: number[] = [];
    await executeBatch(batchId, (p) => progress.push(p.runsDone));
    const b = await getBatch(batchId);
    expect(b.status).toBe('completed');
    expect(b.runs_completed).toBe(STRATEGY_NAMES.length);
    expect(b.runs_failed).toBe(0);
    expect(b.rounds_completed).toBe(STRATEGY_NAMES.length * 4);
    expect(b.examples_created).toBe(STRATEGY_NAMES.length * 3); // label rounds 2..4
    expect(progress).toEqual(STRATEGY_NAMES.map((_, i) => i + 1));
    expect(b.summary.byStrategy.map((s: any) => s.strategy).sort()).toEqual([...STRATEGY_NAMES].sort());

    const runs = (await getPool().query('SELECT * FROM runs WHERE simulation_batch_id = $1', [batchId])).rows;
    expect(runs.every((r) => r.source === 'simulation' && r.simulator_version === SIMULATOR_VERSION && r.status === 'completed')).toBe(true);
    const ex = (await getPool().query(
      `SELECT t.* FROM training_examples t JOIN runs r ON r.id = t.run_id WHERE r.simulation_batch_id = $1`, [batchId])).rows;
    expect(ex.every((e) => e.source === 'simulation' && e.simulator_version === SIMULATOR_VERSION && e.seed)).toBe(true);
    // Agent actions go through the validated ledger with actor='agent'.
    const agentEvents = await getPool().query(`SELECT count(*)::int AS n FROM progression_events WHERE actor = 'agent'`);
    expect(agentEvents.rows[0].n).toBeGreaterThan(0);
    // Every player loadout actually used in combat was legal.
    const snaps = await getPool().query(
      `SELECT x.player_pre FROM rounds x JOIN runs r ON r.id = x.run_id WHERE r.simulation_batch_id = $1`, [batchId]);
    for (const s of snaps.rows) expect(isLegalLoadout(s.player_pre.loadout, s.player_pre.inventory)).toBe(true);
  });

  it('archer goes ranged once it can afford a bow (label 1 appears)', async () => {
    const batchId = await createBatch(normalizeConfig({ runs: 2, maxRounds: 6, strategies: ['archer'], seed: 'sim-test-archer' }));
    await executeBatch(batchId);
    const labels = (await getPool().query(
      `SELECT t.label FROM training_examples t JOIN runs r ON r.id = t.run_id WHERE r.simulation_batch_id = $1`, [batchId])).rows;
    expect(labels.some((l) => l.label === 1)).toBe(true);
  });

  it('same seed + settings reproduces the same fights, and re-running appends instead of overwriting', async () => {
    const config = normalizeConfig({ runs: 3, maxRounds: 3, strategies: ['hybrid', 'random', 'adaptive'], seed: 'sim-test-repro' });
    const b1 = await createBatch(config);
    await executeBatch(b1);
    const b2 = await createBatch(config);
    await executeBatch(b2);
    const f1 = await fingerprint(b1);
    const f2 = await fingerprint(b2);
    expect(f1.length).toBe(9);
    expect(f2).toEqual(f1);
    const total = await getPool().query(`SELECT count(*)::int AS n FROM runs WHERE source = 'simulation'`);
    expect(total.rows[0].n).toBe(6);
  });

  it('rejects invalid batch configuration', () => {
    expect(() => normalizeConfig({ runs: 0 })).toThrow(/runs/);
    expect(() => normalizeConfig({ maxRounds: 99 })).toThrow(/maxRounds/);
    expect(() => normalizeConfig({ strategies: ['wizard'] })).toThrow(/Unknown strategy/);
  });
});

describe('adaptive agent style', () => {
  it('switches after two consecutive losses', () => {
    expect(adaptiveStyle([])).toBe('melee');
    expect(adaptiveStyle([{ roundNumber: 1, winner: 'boss' }])).toBe('melee');
    expect(adaptiveStyle([{ roundNumber: 1, winner: 'boss' }, { roundNumber: 2, winner: 'boss' }])).toBe('ranged');
    expect(adaptiveStyle([
      { roundNumber: 1, winner: 'boss' }, { roundNumber: 2, winner: 'player' }, { roundNumber: 3, winner: 'boss' },
    ])).toBe('melee');
  });
});

describe('live = harness (V3 Phase C2)', () => {
  it('a DB-simulated run and the in-memory harness play identical rounds for the same seed', async () => {
    for (const strategy of ['shield_turtle', 'duelist', 'archer']) {
      const runSeed = `parity:${strategy}`;
      const runId = await playSimulatedRun({ batchId: null, strategy, runSeed, maxRounds: 4 });
      const mem = playInMemoryRun(strategy, runSeed, 4, { rules: LIVE_RULES });
      const rounds = (await getPool().query('SELECT id, round_number, winner FROM rounds WHERE run_id = $1 ORDER BY round_number', [runId])).rows;
      expect(rounds.map((r) => r.winner)).toEqual(mem.rounds.map((r) => r.winner));
      for (const [i, r] of rounds.entries()) {
        const db = await loadEvents(getPool(), r.id);
        const key = (e: CombatEvent) => [e.seq, e.attacker, e.kind, e.mode, e.weaponId, e.defense?.action, e.defense?.success, Math.round(e.damage * 1e6)];
        expect(db.map(key)).toEqual(mem.rounds[i].events.map(key));
      }
    }
  });
});
