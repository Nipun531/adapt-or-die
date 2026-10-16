// Vite config: dev server on 5173, proxies /api to the Express server.
// The API port is read from the repo-root .env file (PORT, default 4000) — NOT from process.env, because
// some launchers set PORT for the Vite process itself. API_PORT in the environment overrides it.
// The proxy targets 127.0.0.1 (not "localhost") to avoid IPv6/IPv4 dual-connect errors on Windows.
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';

function apiPort(): string {
  if (process.env.API_PORT) return process.env.API_PORT;
  try {
    const text = fs.readFileSync(path.resolve(__dirname, '..', '.env'), 'utf8');
    return text.match(/^\s*PORT\s*=\s*(\d+)/m)?.[1] ?? '4000';
  } catch {
    return '4000';
  }
}

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': `http://127.0.0.1:${apiPort()}` } },
});
