import closeWithGrace from 'close-with-grace';
import { pino } from 'pino';
import { buildRuntime } from './bootstrap.js';
import { loadConfig } from './config.js';
import { assertNoDevSeedData, watchForDevSeedData } from './db/dev-seed-guard.js';
import { bullJobs, scheduleRepeatingJobs, startWorker } from './jobs/queue.js';
import { loggerOptions } from './lib/logger.js';

// Background jobs (BullMQ): payment results and reconciliation now; offer timeouts,
// notifications and reminders join in later milestones.
const config = loadConfig();
const log = pino(loggerOptions(config.LOG_LEVEL));
await assertNoDevSeedData(config.APP_ENV, config.DATABASE_URL);
const runtime = buildRuntime(config, log);
const scheduler = bullJobs(runtime.queueConnection);
await scheduleRepeatingJobs(scheduler.queue);
const worker = startWorker(runtime.ctx, runtime.queueConnection, log);

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
  await worker.close(); // lets in-flight jobs finish
  await scheduler.close();
  await runtime.close();
});
