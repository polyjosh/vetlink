import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { normalizePhone } from '@vetlink/shared';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { DomainError } from '../../lib/errors.js';
import { maskPhone } from '../../lib/phone.js';
import { access } from '../auth/access.js';
import { handleInboundSms } from './service.js';

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Africa's Talking incoming-message callback (form-encoded). Unknown fields are ignored.
const inboundBody = z.object({
  from: z.string().min(1).max(32),
  text: z.string().max(1600).default(''),
  id: z.string().min(1).max(128),
  to: z.string().max(32).optional(),
  date: z.string().max(64).optional(),
  linkId: z.string().max(128).optional(),
  networkCode: z.string().max(16).optional(),
});

// Africa's Talking delivery report.
const deliveryBody = z.object({
  id: z.string().max(128),
  status: z.string().max(32),
  phoneNumber: z.string().max(32).optional(),
  failureReason: z.string().max(100).optional(),
  networkCode: z.string().max(16).optional(),
  retryCount: z.string().max(8).optional(),
});

/**
 * Inbound SMS (§8.4, §14). The reply is sent as an SMS; in `SMS_MODE=log` it is also returned in
 * the response body so `pnpm --filter api sms:sim` can show it. Hidden from OpenAPI.
 */
export function smsRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  options: { webhookSecret?: string | undefined; echoReplies: boolean },
): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const token = z.object({ token: z.string().max(256).optional() });
  const checkToken = (given: string | undefined, log: { warn: (m: string) => void }) => {
    if (options.webhookSecret && !sameSecret(given ?? '', options.webhookSecret)) {
      log.warn('SMS webhook with a missing or wrong token');
      throw new DomainError('not_found');
    }
  };

  r.post(
    '/webhooks/sms',
    {
      config: { access: access.public },
      schema: { hide: true, body: inboundBody, querystring: token },
    },
    async (req, reply) => {
      checkToken(req.query.token, req.log);
      const phone = normalizePhone(req.body.from);
      if (!phone) return reply.send({ reply: null });
      const text = await handleInboundSms(
        ctx,
        { providerMessageId: req.body.id, phone, text: req.body.text },
        req.log,
      );
      if (text) {
        try {
          await ctx.sms.send(phone, text);
        } catch (err) {
          req.log.error({ err, phone: maskPhone(phone) }, 'SMS reply failed');
        }
      }
      return reply.send(options.echoReplies ? { reply: text } : {});
    },
  );

  r.post(
    '/webhooks/sms/delivery',
    {
      config: { access: access.public },
      schema: { hide: true, body: deliveryBody, querystring: token },
    },
    async (req, reply) => {
      checkToken(req.query.token, req.log);
      if (!['Success', 'Sent', 'Buffered', 'Submitted'].includes(req.body.status)) {
        req.log.warn(
          {
            status: req.body.status,
            reason: req.body.failureReason,
            network: req.body.networkCode,
          },
          'SMS not delivered',
        );
      }
      return reply.send({});
    },
  );
}
