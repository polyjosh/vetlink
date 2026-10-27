import closeWithGrace from 'close-with-grace';
import { pino } from 'pino';
import { buildApp } from './app.js';
import { buildRuntime } from './bootstrap.js';
import { loadConfig } from './config.js';
import { assertNoDevSeedData, watchForDevSeedData } from './db/dev-seed-guard.js';
import { postgresDependency, redisDependency } from './lib/deps.js';
import { loggerOptions } from './lib/logger.js';

const config = loadConfig();
await assertNoDevSeedData(config.APP_ENV, config.DATABASE_URL);
const runtime = buildRuntime(config, pino(loggerOptions(config.LOG_LEVEL)));
const ctx = runtime.ctx;
const app = buildApp({
  logLevel: config.LOG_LEVEL,
  deps: [postgresDependency(config.DATABASE_URL), redisDependency(config.REDIS_URL)],
  ctx,
  trustProxy: config.TRUST_PROXY,
  minAppVersion: config.MIN_APP_VERSION,
  webhookSecret: config.WEBHOOK_SECRET,
  echoSmsReplies: config.SMS_MODE === 'log',
  // Swagger UI for developers; the API surface is not advertised in production.
  docs: config.APP_ENV !== 'production',
  onClose: () => runtime.close(),
});
const stopSeedWatch = watchForDevSeedData({
  appEnv: config.APP_ENV,
  databaseUrl: config.DATABASE_URL,
  onFound: () => {
    // Fail closed: a seeded admin with a published TOTP secret must not stay reachable.
    app.log.fatal('dev seed accounts found with APP_ENV=production; exiting');
    process.exit(1);
  },
  onError: (err) => app.log.warn({ err }, 'dev seed check failed; retrying'),
});

// SIGTERM/SIGINT: stop accepting connections, finish in-flight requests, close dependencies.
closeWithGrace({ delay: 10_000 }, async ({ signal, err }) => {
  if (err) app.log.error({ err }, 'shutting down after error');
  else app.log.info({ signal }, 'shutting down');
  await stopSeedWatch();
  await app.close();
});

await app.listen({ host: config.HOST, port: config.PORT });
