import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { messages } from '@vetlink/i18n';
import { normalizePhone } from '@vetlink/shared';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { DomainError } from '../../lib/errors.js';
import { access } from '../auth/access.js';
import { handleUssd } from './engine.js';

/** Requests per phone per window: a menu walk is ~6 requests; this stops scripted floods. */
export const USSD_RATE_LIMIT = { limit: 60, windowMs: 10 * 60 * 1000 };

const ussdBody = z.object({
  sessionId: z.string().min(1).max(128),
  serviceCode: z.string().max(32).optional(),
  phoneNumber: z.string().min(1).max(32),
  networkCode: z.string().max(16).optional(),
  text: z.string().max(1000).default(''),
});

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Africa's Talking USSD callback (§14): form-encoded in, `text/plain` `CON …`/`END …` out.
 * Not for app clients, so it is hidden from the OpenAPI document. When a webhook secret is
 * configured (required in production), the callback URL must carry it as `?token=`.
 */
export function ussdRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  options: { webhookSecret?: string | undefined },
): void {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/webhooks/ussd',
    {
      config: { access: access.public },
      schema: {
        hide: true,
        body: ussdBody,
        querystring: z.object({ token: z.string().max(256).optional() }),
      },
    },
    async (req, reply) => {
      const secret = options.webhookSecret;
      if (secret && !sameSecret(req.query.token ?? '', secret)) {
        req.log.warn('USSD webhook with a missing or wrong token');
        throw new DomainError('not_found');
      }
      const phone = normalizePhone(req.body.phoneNumber);
      const send = (kind: 'CON' | 'END', text: string) =>
        reply.type('text/plain; charset=utf-8').send(`${kind} ${text}`);
      if (!phone) return send('END', messages.sw.ussd.error);

      const hits = await ctx.counters.hit(`ussd:${phone}`, USSD_RATE_LIMIT.windowMs);
      if (hits > USSD_RATE_LIMIT.limit) return send('END', messages.sw.ussd.tooMany);

      const res = await handleUssd(
        ctx,
        { sessionId: req.body.sessionId, phone, text: req.body.text },
        req.log,
      );
      return send(res.kind, res.text);
    },
  );
}
