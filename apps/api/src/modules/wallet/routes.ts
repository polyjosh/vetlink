import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { WALLET_ENTRY_KINDS } from '@vetlink/shared';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { named, responses } from '../../schemas/common.js';
import { audit } from '../admin/audit.js';
import { access, authOf } from '../auth/access.js';
import { adjustWallet, walletView } from './service.js';

const wallet = named(
  z.object({
    balance: z.number().int().describe('KES; pays the next booking fee automatically'),
    entries: z.array(
      z.object({
        id: z.number().int(),
        amount: z.number().int().describe('Positive credit, negative debit'),
        kind: z.enum(WALLET_ENTRY_KINDS),
        bookingId: z.number().int().nullable(),
        note: z.string().nullable(),
        createdAt: z.string(),
      }),
    ),
  }),
  'Wallet',
);

/** The farmer's VetLink credit (§24.25); finance admins view and correct it. */
export function walletRoutes(app: FastifyInstance, ctx: AppContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/v1/wallet',
    {
      config: { access: access.role('farmer') },
      schema: {
        tags: ['farmer'],
        summary: 'My VetLink credit and its latest 50 entries',
        description:
          'Credit replaces refunds and pays the next booking fee; it cannot be withdrawn.',
        response: responses({ 200: wallet }),
      },
    },
    async (req) => walletView(ctx.db, authOf(req).userId),
  );

  const userParams = z.object({ userId: z.uuid() });

  r.get(
    '/v1/admin/users/:userId/wallet',
    {
      config: { access: access.admin('finance') },
      schema: {
        tags: ['admin: payments'],
        summary: "A farmer's VetLink credit",
        params: userParams,
        response: responses({ 200: wallet }),
      },
    },
    async (req) => walletView(ctx.db, req.params.userId, 200),
  );

  r.post(
    '/v1/admin/users/:userId/wallet/adjust',
    {
      config: { access: access.admin('finance', { stepUp: true }) },
      schema: {
        tags: ['admin: payments'],
        summary: 'Correct a farmer’s credit (step-up; reason required; audited)',
        params: userParams,
        body: z.object({
          amount: z
            .number()
            .int()
            .min(-100_000)
            .max(100_000)
            .refine((n) => n !== 0, 'not zero'),
          note: z.string().trim().min(5).max(300),
        }),
        response: responses({ 200: wallet }),
      },
    },
    async (req) => {
      const admin = authOf(req);
      const balance = await adjustWallet(ctx, {
        userId: req.params.userId,
        amount: req.body.amount,
        note: req.body.note,
        adminUserId: admin.userId,
      });
      await audit(
        ctx.db,
        {
          actorUserId: admin.userId,
          action: 'wallet.adjusted',
          entity: 'user',
          entityId: req.params.userId,
          meta: { amount: req.body.amount, balance, note: req.body.note },
        },
        ctx.clock(),
      );
      return walletView(ctx.db, req.params.userId, 200);
    },
  );
}
