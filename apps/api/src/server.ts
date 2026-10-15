import closeWithGrace from 'close-with-grace';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { assertNoDevSeedData } from './db/dev-seed-guard.js';
import { postgresDependency, redisDependency } from './lib/deps.js';

const config = loadConfig();
await assertNoDevSeedData(config.APP_ENV, config.DATABASE_URL);
const app = buildApp({
  logLevel: config.LOG_LEVEL,
  deps: [postgresDependency(config.DATABASE_URL), redisDependency(config.REDIS_URL)],
});

// SIGTERM/SIGINT: stop accepting connections, finish in-flight requests, close dependencies.
closeWithGrace({ delay: 10_000 }, async ({ signal, err }) => {
  if (err) app.log.error({ err }, 'shutting down after error');
  else app.log.info({ signal }, 'shutting down');
  await app.close();
});

await app.listen({ host: config.HOST, port: config.PORT });
