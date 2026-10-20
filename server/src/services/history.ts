/**
 * Read-side helpers that rebuild domain objects from RAW database rows.
 * Used by the boss (history for decisions), ML example construction and the API.
 * Keeping these conversions in one place means features can always be recomputed from raw records.
 */
import type { CombatEvent } from '../game/combat.js';
import { summarizeCombat } from '../game/summary.js';
import type { CombatantState, Side } from '../game/types.js';
import type { Db } from '../db/pool.js';
import type { RoundRecord } from '../ml/features.js';

export function rowToCombatant(row: any): CombatantState {
  return {
    side: row.side,
    level: row.level,
    xp: row.xp,
    gold: row.gold,
    statPoints: row.stat_points,
    stats: row.stats,
    inventory: row.inventory,
    loadout: row.loadout,
    ...(row.supplies ? { supplies: row.supplies } : {}),
  };
}

export function rowToEvent(r: any): CombatEvent {
  return {
    seq: r.seq,
    turn: r.turn,
    phase: r.phase,
    attacker: r.attacker,
    defender: r.defender,
    mode: r.mode,
    weaponId: r.weapon_id,
    choiceSource: r.choice_source,
    choiceReason: r.choice_reason ?? undefined,
    calc: r.calc,
    damage: r.damage,
    defenderHpBefore: r.defender_hp_before,
    defenderHpAfter: r.defender_hp_after,
    attackerHp: r.attacker_hp,
    ...(r.kind ? { kind: r.kind } : {}),
    ...(r.parent_seq != null ? { parentSeq: r.parent_seq } : {}),
    ...(r.defense ? { defense: r.defense } : {}),
    ...(r.stun ? { stun: r.stun } : {}),
  };
}

export async function loadEvents(db: Db, roundId: number): Promise<CombatEvent[]> {
  const r = await db.query('SELECT * FROM combat_events WHERE round_id = $1 ORDER BY seq', [roundId]);
  return r.rows.map(rowToEvent);
}

export interface CompletedRoundRow {
  id: number;
  record: RoundRecord;
  bossPost: CombatantState;
}

/** Completed rounds 1..upTo (inclusive) of a run, oldest first, as RoundRecords. */
export async function loadCompletedRounds(db: Db, runId: number, upTo = 2_147_483_647): Promise<CompletedRoundRow[]> {
  const rounds = await db.query(
    `SELECT * FROM rounds WHERE run_id = $1 AND status = 'completed' AND round_number <= $2 ORDER BY round_number`,
    [runId, upTo],
  );
  if (rounds.rowCount === 0) return [];
  const ids = rounds.rows.map((r) => r.id);
  const ev = await db.query('SELECT * FROM combat_events WHERE round_id = ANY($1) ORDER BY round_id, seq', [ids]);
  const byRound = new Map<number, CombatEvent[]>();
  for (const row of ev.rows) {
    if (!byRound.has(row.round_id)) byRound.set(row.round_id, []);
    byRound.get(row.round_id)!.push(rowToEvent(row));
  }
  return rounds.rows.map((r) => ({
    id: r.id,
    bossPost: r.boss_post,
    record: {
      roundNumber: r.round_number,
      winner: r.winner as Side,
      playerSnapshot: r.player_snapshot,
      bossSnapshot: r.boss_snapshot,
      playerPost: r.player_post,
      playerHpEnd: r.player_hp_end,
      bossHpEnd: r.boss_hp_end,
      summary: summarizeCombat(byRound.get(r.id) ?? [], r.combat_notes ?? []),
    },
  }));
}
