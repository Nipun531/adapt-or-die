/**
 * Dev helper: run the API against TEST_DATABASE_URL instead of DATABASE_URL (`npm run dev:testdb`).
 * For clicking through the UI (new runs, rounds, shop) without writing to the dev database.
 * The test database is wiped by `npm test`, so nothing created here is kept.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });
if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is not set in .env');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
console.log('[dev:testdb] API is using TEST_DATABASE_URL (wiped by npm test)');
await import('./index.js');
