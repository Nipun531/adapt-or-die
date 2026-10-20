/**
 * V4 NEXT-BUILD TRAINING ROWS (table build_examples; Prepared Boss runs only — Learning and PvP never enter).
 * One row per (run, label round N+1 ≥ 2): features from rounds 1..N (ml/build-features.ts), label = the heads the
 * player actually brought into round N+1 (boss/build-heads.ts: round N's post-state → round N+1's snapshot).
 * Rows are appended, never overwritten; older tables (training_examples) are untouched.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { env, REPO_ROOT } from '../config/env.js';
import type { Db } from '../db/pool.js';
import { BUILD_TARGET_VERSION, headsOf, HEAD_NAMES, type Heads } from '../boss/build-heads.js';
import { initialCombatant } from '../game/progression.js';
import { loadCompletedRounds } from '../services/history.js';
import { BUILD_FEATURE_NAMES, BUILD_FEATURE_SCHEMA, buildTaskFeatures } from './build-features.js';

/** Heads of every completed round of a run (round i's choice, from round i−1's post-state). */
function runHeads(rows: Awaited<ReturnType<typeof loadCompletedRounds>>, ev: string): Heads[] {
  return rows.map((r, i) => headsOf(i === 0 ? initialCombatant('player') : rows[i - 1].record.playerPost, r.record.playerSnapshot, ev));
}

export async function buildMissingBuildExamples(db: Db, opts: { engineVersion?: string } = {}): Promise<{ runs: number; inserted: number }> {
  const runs = (await db.query(
    `SELECT u.id, u.source, u.engine_version, u.simulator_version FROM runs u
     WHERE u.mode = 'prepared' AND u.engine_version = $1
       AND EXISTS (SELECT 1 FROM rounds r WHERE r.run_id = u.id AND r.status = 'completed' AND r.round_number >= 2
         AND NOT EXISTS (SELECT 1 FROM build_examples b WHERE b.label_round_id = r.id AND b.feature_schema_version = $2 AND b.target_version = $3))
     ORDER BY u.id`, [opts.engineVersion ?? (await import('../game/constants.js')).ENGINE_VERSION, BUILD_FEATURE_SCHEMA, BUILD_TARGET_VERSION])).rows;
  let inserted = 0;
  for (const run of runs) {
    const rows = await loadCompletedRounds(db, run.id, 1000);
    const heads = runHeads(rows, run.engine_version);
    const values: unknown[] = [];
    const tuples: string[] = [];
    for (let n = 1; n < rows.length; n++) { // label round = rows[n] (round n+1), features = rounds 1..n
      const p = values.length;
      values.push(run.id, rows[n - 1].id, rows[n].id, BUILD_FEATURE_SCHEMA, BUILD_TARGET_VERSION, run.source, run.engine_version, run.simulator_version,
        JSON.stringify(buildTaskFeatures(rows.slice(0, n).map((r) => r.record), heads.slice(0, n), run.engine_version)), JSON.stringify(heads[n]), true);
      tuples.push(`(${Array.from({ length: 11 }, (_, k) => `$${p + k + 1}`).join(',')})`);
    }
    if (!tuples.length) continue;
    const res = await db.query(
      `INSERT INTO build_examples (run_id, feature_round_id, label_round_id, feature_schema_version, target_version, source, engine_version,
         simulator_version, features, heads, is_valid) VALUES ${tuples.join(',')}
       ON CONFLICT (label_round_id, feature_schema_version, target_version) DO NOTHING`, values);
    inserted += res.rowCount ?? 0;
  }
  return { runs: runs.length, inserted };
}

/** Versioned CSV snapshot (artifacts/datasets/build-v4b1-b1_<stamp>.csv) with provenance columns and a sha256. */
export async function exportBuildDataset(db: Db): Promise<{ csvPath: string; rows: number; sha256: string; byStrategy: Record<string, number> }> {
  const rows = (await db.query(
    `SELECT b.id, b.run_id, b.feature_round_id, b.label_round_id, b.source, b.simulator_version, u.player_strategy, r.round_number, b.features, b.heads
     FROM build_examples b JOIN runs u ON u.id = b.run_id JOIN rounds r ON r.id = b.label_round_id
     WHERE b.feature_schema_version = $1 AND b.target_version = $2 AND b.is_valid AND u.mode = 'prepared' ORDER BY b.id`,
    [BUILD_FEATURE_SCHEMA, BUILD_TARGET_VERSION])).rows;
  const cell = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const header = ['example_id', 'run_id', 'feature_round_id', 'label_round_id', 'source', 'simulator_version', 'player_strategy', 'label_round_number',
    ...HEAD_NAMES.map((h) => `y_${h}`), ...BUILD_FEATURE_NAMES];
  const lines = [header.join(',')];
  const byStrategy: Record<string, number> = {};
  for (const r of rows) {
    byStrategy[r.player_strategy ?? 'manual'] = (byStrategy[r.player_strategy ?? 'manual'] ?? 0) + 1;
    lines.push([r.id, r.run_id, r.feature_round_id, r.label_round_id, r.source, r.simulator_version, r.player_strategy ?? 'manual', r.round_number,
      ...HEAD_NAMES.map((h) => r.heads[h]), ...BUILD_FEATURE_NAMES.map((f) => r.features[f])].map(cell).join(','));
  }
  const csv = lines.join('\n') + '\n';
  const dir = path.join(env.artifactsDir, 'datasets');
  fs.mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, `build-${BUILD_FEATURE_SCHEMA}-${BUILD_TARGET_VERSION}_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
  fs.writeFileSync(abs, csv);
  const sha256 = crypto.createHash('sha256').update(csv).digest('hex');
  fs.writeFileSync(abs.replace(/\.csv$/, '.json'), JSON.stringify({ rows: rows.length, byStrategy, sha256, featureSchema: BUILD_FEATURE_SCHEMA, target: BUILD_TARGET_VERSION, heads: HEAD_NAMES }, null, 2));
  return { csvPath: path.relative(REPO_ROOT, abs), rows: rows.length, sha256, byStrategy };
}
