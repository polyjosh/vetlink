import Fastify, { type FastifyInstance } from 'fastify';
import type { DestinationStream } from 'pino';
import type { AppContext } from './context.js';
import type { DependencyCheck } from './lib/deps.js';
import { registerErrorHandling } from './lib/errors.js';
import { loggerOptions } from './lib/logger.js';
import { registerAccessControl } from './modules/auth/access.js';
import { authRoutes } from './modules/auth/routes.js';
import { userRoutes } from './modules/users/routes.js';
import { healthRoutes } from './routes/health.js';

export interface AppOptions {
  logLevel: string;
  deps: DependencyCheck[];
  /** Database-backed services. Without it only the public health routes exist. */
  ctx?: AppContext;
  /** Called after the access-control hook is installed; tests use it to add probe routes. */
  extraRoutes?: (app: FastifyInstance) => void;
  /** Closed with the app (database pool, Redis client). */
  onClose?: () => Promise<void>;
  /** Log destination (tests capture logs to assert nothing sensitive is written). */
  logStream?: DestinationStream;
}

export function buildApp({
  logLevel,
  deps,
  ctx,
  extraRoutes,
  onClose,
  logStream,
}: AppOptions): FastifyInstance {
  const logger = loggerOptions(logLevel);
  const app = Fastify({ logger: logStream ? { ...logger, stream: logStream } : logger });
  registerErrorHandling(app);
  // Must run before any route is added: it rejects routes without an access declaration.
  registerAccessControl(app, ctx ?? null);
  healthRoutes(app, deps);
  if (ctx) {
    authRoutes(app, ctx);
    userRoutes(app, ctx);
  }
  extraRoutes?.(app);
  app.addHook('onClose', async () => {
    await Promise.all(deps.map((d) => d.close()));
    await onClose?.();
  });
  return app;
}
