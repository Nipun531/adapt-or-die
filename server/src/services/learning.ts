/**
 * LEARNING BOSS OBSERVATIONS + PROFILE SUMMARY (V4).
 *
 * After every COMPLETED round of a Learning Boss run, one observation is appended to the run's profile:
 *   context  what was known before the player prepared (round number, previous result, gold/points available)
 *   heads    what the player actually CHOSE for the round (boss/build-heads.ts)
 *   outcome  what then HAPPENED (winner, HP left) — kept apart from the choice, so frequent use ≠ effective
 * Observations are the Learning Boss's only learned knowledge; they never enter the global training tables.
 */
import { headsOf, HEAD_CLASSES, HEAD_NAMES, type HeadName, type Heads } from '../boss/build-heads.js';
import type { Db } from '../db/pool.js';
import { initialCombatant } from '../game/progression.js';
import type { CombatantState, FighterSnapshot } from '../game/types.js';
import type { ProfileRow } from './profiles.js';

export interface Observation {
  runId?: number;
  roundNumber: number;
  context: { previousWinner: 'player' | 'boss' | null; gold: number; statPoints: number; previousHeads: Heads | null };
  heads: Heads;
  outcome: { winner: 'player' | 'boss'; playerHpEndFrac: number; bossHpEndFrac: number };
}

export async function recordObservation(c: Db, run: any, roundId: number, roundNumber: number): Promise<void> {
  if (run.mode !== 'learning' || !run.profile_id) return;
  const rows = (await c.query(
    `SELECT id, round_number, winner, player_snapshot, boss_snapshot, player_post, player_hp_end, boss_hp_end
     FROM rounds WHERE run_id = $1 AND round_number IN ($2, $3) AND status = 'completed' ORDER BY round_number`,
    [run.id, roundNumber - 1, roundNumber])).rows;
  const cur = rows.find((r) => r.round_number === roundNumber);
  if (!cur) return;
  const prevRow = rows.find((r) => r.round_number === roundNumber - 1);
  const prev: CombatantState = prevRow ? prevRow.player_post : initialCombatant('player');
  const snap = cur.player_snapshot as FighterSnapshot;
  const prevObs = (await c.query('SELECT heads FROM profile_observations WHERE run_id = $1 AND round_number = $2', [run.id, roundNumber - 1])).rows[0];
  const obs: Observation = {
    roundNumber,
    context: { previousWinner: prevRow ? prevRow.winner : null, gold: prev.gold, statPoints: prev.statPoints, previousHeads: prevObs?.heads ?? null },
    heads: headsOf(prev, snap, run.engine_version),
    outcome: {
      winner: cur.winner,
      playerHpEndFrac: Math.max(0, cur.player_hp_end) / snap.derived.maxHp,
      bossHpEndFrac: Math.max(0, cur.boss_hp_end) / (cur.boss_snapshot as FighterSnapshot).derived.maxHp,
    },
  };
  await c.query(
    `INSERT INTO profile_observations (profile_id, run_id, round_id, round_number, context, heads, outcome, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (round_id) DO NOTHING`,
    [run.profile_id, run.id, roundId, roundNumber, JSON.stringify(obs.context), JSON.stringify(obs.heads), JSON.stringify(obs.outcome),
      run.source === 'manual' ? 'manual' : 'synthetic'],
  );
}

/** All observations of a profile, oldest first. */
export async function loadObservations(db: Db, profileId: number): Promise<Observation[]> {
  const r = await db.query('SELECT run_id, round_number, context, heads, outcome FROM profile_observations WHERE profile_id = $1 ORDER BY created_at, id', [profileId]);
  return r.rows.map((x) => ({ runId: Number(x.run_id), roundNumber: x.round_number, context: x.context, heads: x.heads, outcome: x.outcome }));
}

const LABELS: { [K in HeadName]: Record<string, string> } = {
  hands: { ranged: 'a bow alone', ranged_melee: 'a bow with a melee weapon', ranged_shield: 'a bow with a shield', melee: 'a melee weapon alone', melee_shield: 'a melee weapon and a shield', shield: 'only a shield', empty: 'empty hands' },
  family: { blade: 'blades', blunt: 'blunt weapons', polearm: 'polearms', none: 'no melee weapon' },
  armour: { none: 'no armour', keep: 'the same armour', upgrade: 'new or better armour' },
  alloc: { str: 'Strength', def: 'Defence', dex: 'Speed (DEX)', hp: 'Health', none: 'no stat points' },
};

/**
 * Evidence-based insights: a head is reported only when one choice has been seen at least 3 times and in ≥ 60% of
 * the profile's rounds. Each line states its counts, so nothing is claimed beyond what was recorded.
 */
export function insightsOf(obs: Observation[]): { head: HeadName; text: string; count: number; of: number }[] {
  const out: { head: HeadName; text: string; count: number; of: number }[] = [];
  if (obs.length < 3) return out;
  for (const h of HEAD_NAMES) {
    const counts = new Map<string, number>();
    for (const o of obs) counts.set(o.heads[h], (counts.get(o.heads[h]) ?? 0) + 1);
    const [best, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (n >= 3 && n / obs.length >= 0.6 && !(h === 'family' && best === 'none') && !(h === 'alloc' && best === 'none')) {
      const verb = h === 'alloc' ? `put most points into ${LABELS.alloc[best]}` : h === 'armour' ? `came with ${LABELS.armour[best]}` : `fought with ${LABELS[h][best]}`;
      out.push({ head: h, text: `You ${verb} in ${n} of ${obs.length} rounds.`, count: n, of: obs.length });
    }
  }
  const afterLoss = obs.filter((o) => o.context.previousWinner === 'boss' && o.context.previousHeads);
  const switched = afterLoss.filter((o) => o.context.previousHeads!.hands !== o.heads.hands).length;
  if (afterLoss.length >= 3) {
    out.push({ head: 'hands', text: `After a loss you changed your hands in ${switched} of ${afterLoss.length} rounds.`, count: switched, of: afterLoss.length });
  }
  return out;
}

export async function profileSummary(db: Db, p: ProfileRow) {
  const obs = await loadObservations(db, p.id);
  const runs = (await db.query(
    `SELECT r.id, r.status, r.max_rounds, r.created_at,
       (SELECT count(*)::int FROM rounds x WHERE x.run_id = r.id AND x.winner = 'player') AS player_wins,
       (SELECT count(*)::int FROM rounds x WHERE x.run_id = r.id AND x.winner = 'boss') AS boss_wins
     FROM runs r WHERE r.profile_id = $1 ORDER BY r.id DESC LIMIT 20`, [p.id])).rows;
  return {
    profile: { id: p.id, name: p.name, status: p.status, createdAt: p.created_at },
    observations: obs.length,
    sources: obs.length ? 'recorded from your completed Learning Boss rounds' : 'nothing recorded yet',
    insights: insightsOf(obs),
    heads: HEAD_CLASSES,
    runs,
  };
}
