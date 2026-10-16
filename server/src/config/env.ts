/**
 * Loads and validates environment variables from the repo-root .env.
 * Only non-secret values are ever logged (see describeDatabaseUrl).
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Absolute path of the repository root (server/src/config → ../../..). */
export const REPO_ROOT = path.resolve(here, '../../..');

dotenv.config({ path: path.join(REPO_ROOT, '.env') });

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Environment variable ${name} must be a number (got "${raw}")`);
  return n;
}

export const env = {
  databaseUrl: process.env.DATABASE_URL ?? '',
  testDatabaseUrl: process.env.TEST_DATABASE_URL ?? '',
  port: intEnv('PORT', 4000),
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
  pythonBin: process.env.PYTHON_BIN ?? 'python',
  artifactsDir: path.resolve(REPO_ROOT, process.env.ARTIFACTS_DIR ?? 'artifacts'),
  defaultMaxRounds: intEnv('DEFAULT_MAX_ROUNDS', 10),
};

/** Connection string with the password masked — safe for logs and error messages. */
export function describeDatabaseUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '****';
    return u.toString();
  } catch {
    return '(invalid DATABASE_URL)';
  }
}
