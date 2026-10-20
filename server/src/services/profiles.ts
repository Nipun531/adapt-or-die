/**
 * LEARNING BOSS PROFILES (V4, docs/V4_IMPLEMENTATION_PLAN.md §3).
 *
 * There is no account system, so a profile is identified by a random UUID `key` that only the owner's browser holds.
 * Every profile call must present that key, so two browsers (or two people) never share or merge a profile.
 * "Start fresh" archives the current profile — its observations stay as history, nothing is deleted — and returns a
 * new, empty profile with a new key. A profile's observations are its ONLY learned knowledge (never the global data).
 */
import crypto from 'node:crypto';
import type { Db } from '../db/pool.js';
import { RuleError } from '../game/equipment.js';
import { NotFoundError } from './runs.js';

export interface ProfileRow { id: number; key: string; name: string; status: 'active' | 'archived'; created_at: string; archived_at: string | null }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function cleanName(name: unknown): string {
  const n = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ').slice(0, 40) : '';
  return n || 'Challenger';
}

export async function createProfile(db: Db, name?: string): Promise<ProfileRow> {
  const r = await db.query('INSERT INTO learning_profiles (key, name) VALUES ($1, $2) RETURNING *', [crypto.randomUUID(), cleanName(name)]);
  return r.rows[0];
}

/** The profile behind a key (active or archived). Unknown or malformed keys are "not found", never another profile. */
export async function profileByKey(db: Db, key: unknown): Promise<ProfileRow> {
  if (typeof key !== 'string' || !UUID.test(key)) throw new NotFoundError('Learning profile not found');
  const r = await db.query('SELECT * FROM learning_profiles WHERE key = $1', [key]);
  if (!r.rows[0]) throw new NotFoundError('Learning profile not found');
  return r.rows[0];
}

export async function activeProfileByKey(db: Db, key: unknown): Promise<ProfileRow> {
  const p = await profileByKey(db, key);
  if (p.status !== 'active') throw new RuleError('This learning profile was archived; start a fresh one');
  return p;
}

/** Archive the profile (no deletion) and return a fresh one with the same name and a new key. */
export async function startFresh(db: Db, key: unknown, name?: string): Promise<ProfileRow> {
  const old = await profileByKey(db, key);
  await db.query(`UPDATE learning_profiles SET status = 'archived', archived_at = now() WHERE id = $1 AND status = 'active'`, [old.id]);
  await db.query(`UPDATE runs SET status = 'completed', end_reason = 'profile_archived', ended_at = now(), updated_at = now()
    WHERE profile_id = $1 AND status = 'active'`, [old.id]);
  return createProfile(db, name ?? old.name);
}

/** A learning run may only be changed by the holder of its profile's key. */
export async function assertRunAccess(db: Db, runId: number, key: unknown): Promise<void> {
  const r = await db.query('SELECT mode, profile_id FROM runs WHERE id = $1', [runId]);
  if (!r.rows[0] || r.rows[0].mode !== 'learning') return;
  const p = await profileByKey(db, key).catch(() => null);
  if (!p || Number(p.id) !== Number(r.rows[0].profile_id)) throw new RuleError('This Learning Boss run belongs to another profile');
}
