/**
 * Web end-to-end run (M11): a throwaway database, the API and worker in dev mode (fixed OTP, mock
 * M-Pesa, logged SMS and push), the Next.js app, then Playwright. Everything is torn down after.
 *
 *   pnpm test:e2e            (TEST_DATABASE_URL and TEST_REDIS_URL, as for the API tests)
 *
 * Never touches the dev database: the DB is created and dropped here, Redis uses its own index.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { runMigrations } from '../src/db/migrate.js';
import { createDb } from '../src/db/client.js';
import { fieldCrypto } from '../src/lib/crypto.js';
import { seed } from '../src/db/seed/seed.js';

const root = new URL('../../../', import.meta.url).pathname;

// Like vitest.config.ts: only the two TEST_* variables are taken from the root .env.
const rootEnv = `${root}.env`;
if (existsSync(rootEnv)) {
  const env = parseEnv(readFileSync(rootEnv, 'utf8'));
  for (const name of ['TEST_DATABASE_URL', 'TEST_REDIS_URL'] as const) {
    if (!process.env[name] && env[name]) process.env[name] = env[name];
  }
}
const serverUrl = process.env.TEST_DATABASE_URL;
const redisBase = process.env.TEST_REDIS_URL;
if (!serverUrl || !redisBase) {
  process.stderr.write('e2e: set TEST_DATABASE_URL and TEST_REDIS_URL\n');
  process.exit(1);
}

const API_PORT = Number(process.env.E2E_API_PORT ?? 4100);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3100);
const OTP = '123456';

const name = `vetlink_e2e_${randomBytes(4).toString('hex')}`;
const admin = postgres(serverUrl, { max: 1, onnotice: () => {} });
const children: ChildProcess[] = [];
let exitCode = 1;

async function waitFor(url: string, timeoutMs: number) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for ${url}`);
}

function start(label: string, cmd: string, args: string[], env: NodeJS.ProcessEnv, cwd: string) {
  const child = spawn(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  const prefix = (chunk: Buffer) =>
    process.env.E2E_VERBOSE ? process.stdout.write(`[${label}] ${chunk.toString()}`) : undefined;
  child.stdout?.on('data', prefix);
  child.stderr?.on('data', (c: Buffer) =>
    process.env.E2E_VERBOSE || label === 'web'
      ? process.stderr.write(`[${label}] ${c.toString()}`)
      : undefined,
  );
  children.push(child);
  return child;
}

try {
  await admin.unsafe(`create database ${name}`);
  const u = new URL(serverUrl);
  u.pathname = `/${name}`;
  const dbUrl = u.toString();
  await runMigrations(dbUrl);

  const dataKey = randomBytes(32).toString('base64');
  const handle = createDb(dbUrl, { max: 1 });
  await seed(handle.db, fieldCrypto(dataKey));
  await handle.close();

  // Index 14 belongs to this script. Job IDs are keyed by booking ID and every fresh database
  // starts at booking 1, so leftovers from an earlier run would make BullMQ drop new jobs as
  // duplicates (and old OTP counters would rate-limit sign-in). Local servers only.
  const redis = new URL(redisBase);
  redis.pathname = '/14';
  if (!['localhost', '127.0.0.1', '[::1]', 'redis'].includes(redis.hostname)) {
    throw new Error('e2e: TEST_REDIS_URL must point at a local Redis');
  }
  const r = new Redis(redis.toString(), { lazyConnect: true });
  await r.connect();
  await r.flushdb();
  await r.quit();
  const apiEnv = {
    APP_ENV: 'development',
    PORT: String(API_PORT),
    LOG_LEVEL: process.env.E2E_LOG_LEVEL ?? 'warn',
    DATABASE_URL: dbUrl,
    REDIS_URL: redis.toString(),
    SMS_MODE: 'log',
    PAYMENTS_MODE: 'mock',
    PUSH_MODE: 'log',
    OTP_FIXED_CODE: OTP,
    JWT_SECRET: randomBytes(32).toString('hex'),
    DATA_ENCRYPTION_KEY: dataKey,
    // Not used by the happy path (no uploads); presigning never contacts the server.
    S3_ENDPOINT: 'http://localhost:8333',
    S3_BUCKET: 'vetlink-e2e',
    S3_ACCESS_KEY: 'e2e',
    S3_SECRET_KEY: 'e2e-secret',
    // The web app's session routes call the API from this machine.
    TRUST_PROXY: 'loopback',
  };
  const api = `${root}apps/api`;
  const tsx = `${api}/node_modules/.bin/tsx`;
  start('api', tsx, ['--conditions=@vetlink/source', 'src/server.ts'], apiEnv, api);
  start('worker', tsx, ['--conditions=@vetlink/source', 'src/worker.ts'], apiEnv, api);
  await waitFor(`http://localhost:${API_PORT}/ready`, 60_000);

  // A production build: no on-demand compiling, so timings match real use. Rewrites (API_URL)
  // are fixed at build time.
  const web = `${root}apps/web`;
  const webEnv = { API_URL: `http://localhost:${API_PORT}`, NEXT_TELEMETRY_DISABLED: '1' };
  if (!process.env.E2E_SKIP_BUILD) {
    const build = spawn(`${web}/node_modules/.bin/next`, ['build', '--webpack'], {
      cwd: web,
      env: { ...process.env, ...webEnv },
      stdio: 'inherit',
    });
    const code = await new Promise<number>((resolve) => build.on('exit', (c) => resolve(c ?? 1)));
    if (code !== 0) throw new Error('next build failed');
  }
  start('web', `${web}/node_modules/.bin/next`, ['start', '--port', String(WEB_PORT)], webEnv, web);
  await waitFor(`http://localhost:${WEB_PORT}/login`, 60_000);

  const pw = spawn(`${web}/node_modules/.bin/playwright`, ['test', ...process.argv.slice(2)], {
    cwd: web,
    stdio: 'inherit',
    env: { ...process.env, E2E_BASE_URL: `http://localhost:${WEB_PORT}`, E2E_OTP: OTP },
  });
  exitCode = await new Promise<number>((resolve) => pw.on('exit', (code) => resolve(code ?? 1)));
} catch (err) {
  process.stderr.write(`e2e: ${err instanceof Error ? err.message : String(err)}\n`);
} finally {
  for (const c of children) {
    try {
      if (c.pid) process.kill(-c.pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
  await new Promise((r) => setTimeout(r, 1500));
  await admin.unsafe(`drop database if exists ${name} with (force)`).catch(() => undefined);
  await admin.end();
  process.exit(exitCode);
}
