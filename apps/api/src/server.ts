import closeWithGrace from 'close-with-grace';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createContext } from './context.js';
import { createDb } from './db/client.js';
import { assertNoDevSeedData, watchForDevSeedData } from './db/dev-seed-guard.js';
import { redisCounters } from './lib/counters.js';
import { postgresDependency, redisDependency } from './lib/deps.js';
import { loggerOptions } from './lib/logger.js';
import { createSmsSender } from './lib/sms.js';

const config = loadConfig();
await assertNoDevSeedData(config.APP_ENV, config.DATABASE_URL);
const db = createDb(config.DATABASE_URL);
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });
const ctx = createContext({
  db: db.db,
  counters: redisCounters(redis),
  sms: createSmsSender(config.SMS_MODE, pino(loggerOptions(config.LOG_LEVEL)), config.APP_ENV),
  dataEncryptionKey: config.DATA_ENCRYPTION_KEY,
  jwtSecret: config.JWT_SECRET,
  otpFixedCode: config.OTP_FIXED_CODE,
});
const app = buildApp({
  logLevel: config.LOG_LEVEL,
  deps: [postgresDependency(config.DATABASE_URL), redisDependency(config.REDIS_URL)],
  ctx,
  trustProxy: config.TRUST_PROXY,
  minAppVersion: config.MIN_APP_VERSION,
  // Swagger UI for developers; the API surface is not advertised in production.
  docs: config.APP_ENV !== 'production',
  onClose: async () => {
    redis.disconnect();
    await db.close();
  },
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
