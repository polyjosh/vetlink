import closeWithGrace from 'close-with-grace';
import { pino } from 'pino';
import { loadConfig } from './config.js';
import { redisDependency } from './lib/deps.js';
import { loggerOptions } from './lib/logger.js';

// Placeholder worker: BullMQ queues and schedulers are added in later milestones (M7, M8).
const config = loadConfig();
const log = pino(loggerOptions(config.LOG_LEVEL));
const redis = redisDependency(config.REDIS_URL);

await redis.check();
log.info('worker started');

closeWithGrace({ delay: 30_000 }, async ({ signal, err }) => {
  if (err) log.error({ err }, 'worker shutting down after error');
  else log.info({ signal }, 'worker shutting down');
  await redis.close();
});
