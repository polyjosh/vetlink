import closeWithGrace from 'close-with-grace';
import { pino } from 'pino';
import { loadConfig } from './config.js';
import { assertNoDevSeedData, watchForDevSeedData } from './db/dev-seed-guard.js';
import { redisDependency } from './lib/deps.js';
import { loggerOptions } from './lib/logger.js';

// Placeholder worker: BullMQ queues and schedulers are added in later milestones (M7, M8).
const config = loadConfig();
const log = pino(loggerOptions(config.LOG_LEVEL));
await assertNoDevSeedData(config.APP_ENV, config.DATABASE_URL);
const redis = redisDependency(config.REDIS_URL);

await redis.check();
const stopSeedWatch = watchForDevSeedData({
  appEnv: config.APP_ENV,
  databaseUrl: config.DATABASE_URL,
  onFound: () => {
    log.fatal('dev seed accounts found with APP_ENV=production; exiting');
    process.exit(1);
  },
  onError: (err) => log.warn({ err }, 'dev seed check failed; retrying'),
});
log.info('worker started');

closeWithGrace({ delay: 30_000 }, async ({ signal, err }) => {
  if (err) log.error({ err }, 'worker shutting down after error');
  else log.info({ signal }, 'worker shutting down');
  await stopSeedWatch();
  await redis.close();
});
