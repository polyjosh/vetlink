import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { DependencyCheck } from '../lib/deps.js';
import { access } from '../modules/auth/access.js';

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

const tags = ['health'];

export function healthRoutes(app: FastifyInstance, deps: DependencyCheck[]): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  // Liveness: the process is up. Never touches dependencies.
  r.get(
    '/health',
    {
      config: { access: access.public },
      schema: {
        tags,
        summary: 'Liveness',
        response: { 200: z.object({ status: z.literal('ok') }) },
      },
    },
    async () => ({ status: 'ok' as const }),
  );

  // Readiness: the database and Redis are reachable.
  r.get(
    '/ready',
    {
      config: { access: access.public },
      schema: {
        tags,
        summary: 'Readiness: database and Redis reachable',
        response: {
          200: z.object({ status: z.string(), checks: z.record(z.string(), z.string()) }),
          503: z.object({ status: z.string(), checks: z.record(z.string(), z.string()) }),
        },
      },
    },
    async (request, reply) => {
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
    },
  );
}
