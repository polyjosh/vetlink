import Fastify, { type FastifyInstance } from 'fastify';
import type { DependencyCheck } from './lib/deps.js';
import { loggerOptions } from './lib/logger.js';
import { healthRoutes } from './routes/health.js';

export interface AppOptions {
  logLevel: string;
  deps: DependencyCheck[];
}

export function buildApp({ logLevel, deps }: AppOptions): FastifyInstance {
  const app = Fastify({ logger: loggerOptions(logLevel) });
  healthRoutes(app, deps);
  app.addHook('onClose', async () => {
    await Promise.all(deps.map((d) => d.close()));
  });
  return app;
}
