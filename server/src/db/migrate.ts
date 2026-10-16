/**
 * Minimal SQL migration runner.
 * - Creates the target database if it does not exist (connects to the "postgres" maintenance DB).
 * - Applies server/src/db/migrations/*.sql in filename order, each in its own transaction.
 * - Records applied files in schema_migrations, so re-running is safe.
 * CLI: `npm run db:migrate` (uses DATABASE_URL). Tests call migrate(TEST_DATABASE_URL).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { describeDatabaseUrl, env } from '../config/env.js';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

async function ensureDatabase(url: string): Promise<void> {
  const u = new URL(url);
  const dbName = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (!/^[A-Za-z0-9_]+$/.test(dbName)) throw new Error(`Refusing unusual database name "${dbName}"`);
  u.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: u.toString() });
  await admin.connect();
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (exists.rowCount === 0) {
      await admin.query(`CREATE DATABASE "${dbName}"`);
      console.log(`[migrate] created database ${dbName}`);
    }
  } finally {
    await admin.end();
  }
}

export async function migrate(url: string, log = true): Promise<string[]> {
  await ensureDatabase(url);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const done = new Set((await client.query('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename));
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
        if (log) console.log(`[migrate] applied ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
    if (log && applied.length === 0) console.log('[migrate] database is up to date');
  } finally {
    await client.end();
  }
  return applied;
}

// CLI entry point
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!env.databaseUrl) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
    process.exit(1);
  }
  console.log(`[migrate] target ${describeDatabaseUrl(env.databaseUrl)}`);
  migrate(env.databaseUrl)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`[migrate] ${err.code === 'ECONNREFUSED' ? 'Cannot reach PostgreSQL — run `npm run db:up` and make sure Docker is running.' : err.message}`);
      process.exit(1);
    });
}
