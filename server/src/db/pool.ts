/**
 * PostgreSQL connection pool + transaction helper.
 * `getPool()` lazily creates one pool per connection string (tests use TEST_DATABASE_URL via setDatabaseUrl).
 */
import pg from 'pg';
import { describeDatabaseUrl, env } from '../config/env.js';

// Return BIGINT/BIGSERIAL (int8) columns as JS numbers. Safe here: ids and seeds stay far below 2^53.
pg.types.setTypeParser(20, (v) => Number(v));

let currentUrl = env.databaseUrl;
let pool: pg.Pool | null = null;

export type Db = pg.Pool | pg.PoolClient;

/** Point the app at a different database (used by tests). Closes the previous pool. */
export async function setDatabaseUrl(url: string): Promise<void> {
  if (pool) await pool.end();
  pool = null;
  currentUrl = url;
}

export function getPool(): pg.Pool {
  if (!currentUrl) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and run `npm run db:up` (see README).');
  }
  if (!pool) {
    pool = new pg.Pool({ connectionString: currentUrl, max: 10 });
    pool.on('error', (err) => console.error('[db] idle client error:', err.message));
  }
  return pool;
}

export function currentDatabaseDescription(): string {
  return describeDatabaseUrl(currentUrl);
}

/** Run `fn` inside BEGIN/COMMIT; rolls back on any error. */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) await pool.end();
  pool = null;
}

/** Turns low-level connection errors into an actionable message (never includes the password). */
export function explainDbError(err: unknown): string {
  const e = err as { code?: string; message?: string };
  const where = currentDatabaseDescription();
  if (e.code === 'ECONNREFUSED') return `Cannot reach PostgreSQL at ${where}. Is Docker running? Try \`npm run db:up\`.`;
  if (e.code === '28P01') return `PostgreSQL rejected the credentials for ${where}. Check DATABASE_URL matches POSTGRES_USER/POSTGRES_PASSWORD in .env.`;
  if (e.code === '3D000') return `Database in ${where} does not exist. Run \`npm run db:migrate\` (it creates the database).`;
  if (e.code === '42P01') return `Tables are missing in ${where}. Run \`npm run db:migrate\`.`;
  return e.message ?? String(err);
}
