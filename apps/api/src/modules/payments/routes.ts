import { timingSafeEqual } from 'node:crypto';
import { and, desc, eq, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { PAYMENT_METHODS, PAYMENT_STATUSES, PAYMENT_TYPES } from '@vetlink/shared';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { bookings, payments } from '../../db/schema/index.js';
import { DomainError } from '../../lib/errors.js';
import { intId, named, responses } from '../../schemas/common.js';
import { access, authOf } from '../auth/access.js';
import { completeRefund, requestDeposit, type PaymentRow } from './service.js';

export const payment = named(
  z.object({
    id: z.number().int(),
    bookingId: z.number().int(),
    type: z.enum(PAYMENT_TYPES),
    amount: z.number().int().describe('KES: the whole booking fee'),
    method: z.enum(PAYMENT_METHODS).describe('wallet: paid entirely from VetLink credit'),
    walletAmount: z.number().int().describe('Of the amount, paid from VetLink credit (§24.25)'),
    status: z.enum(PAYMENT_STATUSES),
    receipt: z.string().nullable().describe('M-Pesa receipt, once paid'),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  'Payment',
);

export function paymentView(p: PaymentRow): z.infer<typeof payment> {
  return {
    id: p.id,
    bookingId: p.bookingId,
    type: p.type,
    amount: p.amount,
    method: p.method,
    walletAmount: p.walletAmount,
    status: p.status,
    receipt: p.mpesaReceipt,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

const adminPayment = named(
  payment.extend({ resultCode: z.number().int().nullable(), resultDesc: z.string().nullable() }),
  'AdminPayment',
);

// Daraja's STK callback (§14). Fields beyond these are ignored.
const stkCallbackBody = z.object({
  Body: z.object({
    stkCallback: z.object({
      MerchantRequestID: z.string().max(100),
      CheckoutRequestID: z.string().min(1).max(100),
      ResultCode: z.coerce.number().int(),
      ResultDesc: z.string().max(500),
      CallbackMetadata: z
        .object({
          Item: z.array(
            z.object({ Name: z.string(), Value: z.union([z.string(), z.number()]).optional() }),
          ),
        })
        .optional(),
    }),
  }),
});

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function paymentRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  options: { webhookSecret?: string | undefined },
): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ['payments'];

  r.post(
    '/v1/payments/stk',
    {
      config: { access: access.role('farmer') },
      schema: {
        tags,
        summary: 'Pay the booking deposit: sends an M-Pesa prompt to my phone',
        description:
          'Returns the in-flight or already-paid deposit instead of sending a second prompt. ' +
          'The amount is set by the server. Poll the payment or the booking for the result; ' +
          'the client never marks a payment successful.',
        body: z.object({ bookingId: intId }),
        response: responses({ 202: payment }),
      },
    },
    async (req, reply) => {
      const p = await requestDeposit(
        ctx,
        { bookingId: req.body.bookingId, farmerId: authOf(req).userId },
        req.log,
      );
      return reply.code(202).send(paymentView(p));
    },
  );

  r.get(
    '/v1/payments/:id',
    {
      config: { access: access.role('farmer') },
      schema: {
        tags,
        summary: 'One of my payments (poll after an STK push)',
        params: z.object({ id: intId }),
        response: responses({ 200: payment }),
      },
    },
    async (req) => {
      const [row] = await ctx.db
        .select({ payment: payments })
        .from(payments)
        .innerJoin(bookings, eq(bookings.id, payments.bookingId))
        .where(and(eq(payments.id, req.params.id), eq(bookings.farmerId, authOf(req).userId)))
        .limit(1);
      if (!row) throw new DomainError('not_found');
      return paymentView(row.payment);
    },
  );

  /**
   * Daraja STK callback. Always answers 200 quickly; the result is processed by a job with
   * retries (and confirmed by an STK query). A token in the URL keeps random posts out.
   */
  r.post(
    '/webhooks/mpesa',
    {
      config: { access: access.public },
      schema: {
        hide: true,
        body: stkCallbackBody,
        querystring: z.object({ token: z.string().max(256).optional() }),
      },
    },
    async (req, reply) => {
      const secret = options.webhookSecret;
      if (secret && !sameSecret(req.query.token ?? '', secret)) {
        req.log.warn('M-Pesa webhook with a missing or wrong token');
        throw new DomainError('not_found');
      }
      const cb = req.body.Body.stkCallback;
      const item = (name: string) => cb.CallbackMetadata?.Item.find((i) => i.Name === name)?.Value;
      const amount = item('Amount');
      const receipt = item('MpesaReceiptNumber');
      try {
        await ctx.jobs.add(
          'payments.stk-result',
          {
            checkoutRequestId: cb.CheckoutRequestID,
            resultCode: cb.ResultCode,
            resultDesc: cb.ResultDesc,
            ...(receipt !== undefined && { receipt: String(receipt) }),
            ...(amount !== undefined && { amount: Number(amount) }),
          },
          // Duplicate callbacks for one checkout collapse into one job.
          { jobId: `stk-${cb.CheckoutRequestID}-${cb.ResultCode}` },
        );
      } catch (err) {
        // Reconciliation will settle it; Daraja must still get its 200.
        req.log.error({ err }, 'could not process M-Pesa callback');
      }
      return reply.send({ ResultCode: 0, ResultDesc: 'Accepted' });
    },
  );

  r.get(
    '/v1/admin/payments',
    {
      config: { access: access.admin('finance') },
      schema: {
        tags: ['admin'],
        summary: 'Payments and refunds, newest first (e.g. ?type=refund&status=pending)',
        querystring: z.object({
          type: z.enum(PAYMENT_TYPES).optional(),
          status: z.enum(PAYMENT_STATUSES).optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
        response: responses({ 200: z.array(adminPayment) }),
      },
    },
    async (req) => {
      const conditions: SQL[] = [];
      if (req.query.type) conditions.push(eq(payments.type, req.query.type));
      if (req.query.status) conditions.push(eq(payments.status, req.query.status));
      const rows = await ctx.db
        .select()
        .from(payments)
        .where(and(...conditions))
        .orderBy(desc(payments.id))
        .limit(req.query.limit);
      return rows.map((p) => ({
        ...paymentView(p),
        resultCode: p.resultCode,
        resultDesc: p.resultDesc,
      }));
    },
  );

  r.post(
    '/v1/admin/payments/:id/refund-complete',
    {
      config: { access: access.admin('finance', { stepUp: true }) },
      schema: {
        tags: ['admin'],
        summary: 'Record that a pending refund was sent (M-Pesa reference); audited',
        params: z.object({ id: intId }),
        body: z.object({ mpesaReceipt: z.string().regex(/^[A-Z0-9]{8,20}$/) }),
        response: responses({ 200: payment }),
      },
    },
    async (req) =>
      paymentView(
        await completeRefund(ctx, req.params.id, req.body.mpesaReceipt, authOf(req).userId),
      ),
  );
}
