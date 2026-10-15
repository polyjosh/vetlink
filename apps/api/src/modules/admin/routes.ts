import { and, desc, eq, lt, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { BOOKING_STATUSES } from '@vetlink/shared';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { bookingOffers, bookings, users } from '../../db/schema/index.js';
import { DomainError } from '../../lib/errors.js';
import { intId, named, responses } from '../../schemas/common.js';
import { access, authOf } from '../auth/access.js';
import { resetTwoFactor } from '../auth/two-factor.js';
import { adminBooking, bookingParams, farmerBooking } from '../bookings/schemas.js';
import { cancelByAdmin } from '../bookings/service.js';
import { farmerViews } from '../bookings/views.js';
import { allConfig, setConfig } from '../config/service.js';
import { audit } from './audit.js';

const tags = ['admin'];
const enrolmentReopened = named(z.object({ enrolExpiresAt: z.string() }), 'EnrolmentReopened');

export function adminRoutes(app: FastifyInstance, ctx: AppContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/v1/admin/users/:userId/2fa/reset',
    {
      config: { access: access.admin('super_admin', { stepUp: true }) },
      schema: {
        tags,
        summary: "Reset another admin's 2FA and reopen enrolment for 72 hours (audited)",
        params: z.object({ userId: z.uuid() }),
        response: responses({ 200: enrolmentReopened }),
      },
    },
    async (req) => {
      const { enrolExpiresAt } = await resetTwoFactor(ctx, authOf(req), req.params.userId, req.log);
      return { enrolExpiresAt: enrolExpiresAt.toISOString() };
    },
  );

  r.get(
    '/v1/admin/bookings',
    {
      config: { access: access.admin('support') },
      schema: {
        tags,
        summary: 'Booking queue, newest first',
        querystring: z.object({
          status: z.enum(BOOKING_STATUSES).optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
          before: intId.optional(),
        }),
        response: responses({ 200: z.array(farmerBooking) }),
      },
    },
    async (req) => {
      const q = req.query;
      const conditions: SQL[] = [];
      if (q.status) conditions.push(eq(bookings.status, q.status));
      if (q.before) conditions.push(lt(bookings.id, q.before));
      const rows = await ctx.db
        .select()
        .from(bookings)
        .where(and(...conditions))
        .orderBy(desc(bookings.id))
        .limit(q.limit);
      return farmerViews(ctx.db, rows);
    },
  );

  r.get(
    '/v1/admin/bookings/:id',
    {
      config: { access: access.admin('support') },
      schema: {
        tags,
        summary: "One booking with the farmer's contact and every offer sent",
        params: bookingParams,
        response: responses({ 200: adminBooking }),
      },
    },
    async (req) => {
      const id = req.params.id;
      const [b] = await ctx.db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
      if (!b) throw new DomainError('not_found');
      const [[view], [farmer], offers] = await Promise.all([
        farmerViews(ctx.db, [b]),
        ctx.db
          .select({ name: users.name, phone: users.phone })
          .from(users)
          .where(eq(users.id, b.farmerId)),
        ctx.db
          .select()
          .from(bookingOffers)
          .where(eq(bookingOffers.bookingId, id))
          .orderBy(bookingOffers.id),
      ]);
      if (!view) throw new DomainError('not_found');
      return {
        ...view,
        farmer: farmer ?? null,
        offers: offers.map((o) => ({
          id: o.id,
          vetId: o.vetId,
          wave: o.wave,
          channel: o.channel,
          sentAt: o.sentAt.toISOString(),
          respondedAt: o.respondedAt ? o.respondedAt.toISOString() : null,
          response: o.response,
        })),
      };
    },
  );

  r.post(
    '/v1/admin/bookings/:id/cancel',
    {
      config: { access: access.admin('support', { stepUp: true }) },
      schema: {
        tags,
        summary: 'Cancel a booking (may lead to a refund; step-up; audited)',
        params: bookingParams,
        body: z.object({ reason: z.string().trim().min(3).max(200) }),
        response: responses({ 200: farmerBooking }),
      },
    },
    async (req) => {
      const auth = authOf(req);
      const id = req.params.id;
      const booking = await cancelByAdmin(ctx, id, auth.userId, req.body.reason);
      await audit(
        ctx.db,
        {
          actorUserId: auth.userId,
          action: 'booking.cancelled',
          entity: 'booking',
          entityId: String(id),
          meta: { reason: req.body.reason },
        },
        ctx.clock(),
      );
      const [view] = await farmerViews(ctx.db, [booking]);
      if (!view) throw new DomainError('not_found');
      return view;
    },
  );

  r.get(
    '/v1/admin/config',
    {
      config: { access: access.admin('super_admin') },
      schema: {
        tags,
        summary: 'Runtime settings (matching weights, radii, waves) and whether each is a default',
        response: responses({
          200: z.array(
            z.object({
              key: z.string(),
              value: z.unknown(),
              isDefault: z.boolean(),
              updatedAt: z.string().nullable(),
            }),
          ),
        }),
      },
    },
    async () => allConfig(ctx),
  );

  r.put(
    '/v1/admin/config/:key',
    {
      config: { access: access.admin('super_admin', { stepUp: true }) },
      schema: {
        tags,
        summary: 'Change one runtime setting (validated; step-up; audited)',
        params: z.object({ key: z.string().max(100) }),
        body: z.object({ value: z.unknown() }),
        response: responses({ 204: z.null() }),
      },
    },
    async (req, reply) => {
      const auth = authOf(req);
      await setConfig(ctx, req.params.key, req.body.value, auth.userId);
      await audit(
        ctx.db,
        {
          actorUserId: auth.userId,
          action: 'config.changed',
          entity: 'config',
          entityId: req.params.key,
          meta: { value: req.body.value },
        },
        ctx.clock(),
      );
      return reply.code(204).send(null);
    },
  );
}
