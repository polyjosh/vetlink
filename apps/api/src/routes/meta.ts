import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { named, responses } from '../schemas/common.js';
import { access } from '../modules/auth/access.js';

const minAppVersion = named(
  z.object({ minVersion: z.string().describe('Older apps must update before continuing') }),
  'MinAppVersion',
);

export function metaRoutes(app: FastifyInstance, options: { minAppVersion: string }): void {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/v1/meta/min-app-version',
    {
      config: { access: access.public },
      schema: {
        tags: ['meta'],
        summary: 'Oldest supported app version (force-update gracefully below it)',
        response: responses({ 200: minAppVersion }),
      },
    },
    async () => ({ minVersion: options.minAppVersion }),
  );
}
