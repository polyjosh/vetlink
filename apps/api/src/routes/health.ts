import type { FastifyInstance } from 'fastify';
import type { DependencyCheck } from '../lib/deps.js';

const CHECK_TIMEOUT_MS = 2000;

function withTimeout(promise: Promise<void>, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

export function healthRoutes(app: FastifyInstance, deps: DependencyCheck[]): void {
  // Liveness: the process is up. Never touches dependencies.
  app.get('/health', async () => ({ status: 'ok' }));

  // Readiness: the database and Redis are reachable.
  app.get('/ready', async (request, reply) => {
    const results = await Promise.all(
      deps.map(async (dep) => {
        try {
          await withTimeout(dep.check(), CHECK_TIMEOUT_MS);
          return [dep.name, 'ok'] as const;
        } catch (err) {
          request.log.warn({ dependency: dep.name, err }, 'readiness check failed');
          return [dep.name, 'error'] as const;
        }
      }),
    );
    const checks = Object.fromEntries(results);
    const ready = results.every(([, status]) => status === 'ok');
    return reply.code(ready ? 200 : 503).send({ status: ready ? 'ok' : 'unavailable', checks });
  });
}
