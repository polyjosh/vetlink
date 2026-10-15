import { and, desc, eq, lt, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { BOOKING_STATUSES } from '@vetlink/shared';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { bookingOffers, bookings, users } from '../../db/schema/index.js';
import { DomainError, parseInput } from '../../lib/errors.js';
import { access, authOf } from '../auth/access.js';
import { resetTwoFactor } from '../auth/two-factor.js';
import { cancelByAdmin } from '../bookings/service.js';
import { farmerViews } from '../bookings/views.js';
import { audit } from './audit.js';

const userParams = z.object({ userId: z.uuid() });
const bookingId = z.coerce.number().int().positive().max(2_147_483_647);
const bookingParams = z.object({ id: bookingId });
const listQuery = z.object({
  status: z.enum(BOOKING_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: bookingId.optional(),
});
const cancelBody = z.object({ reason: z.string().trim().min(3).max(200) });

export function adminRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** Reset another admin's 2FA. Super admin only, with a fresh step-up; audit-logged. */
  app.post(
    '/v1/admin/users/:userId/2fa/reset',
    { config: { access: access.admin('super_admin', { stepUp: true }) } },
    async (req) => {
      const { userId } = parseInput(userParams, req.params);
      const { enrolExpiresAt } = await resetTwoFactor(ctx, authOf(req), userId, req.log);
      return { enrolExpiresAt: enrolExpiresAt.toISOString() };
    },
  );

  /** Booking queue for support: newest first, optional status filter. */
  app.get('/v1/admin/bookings', { config: { access: access.admin('support') } }, async (req) => {
    const q = parseInput(listQuery, req.query);
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
  });

  /** One booking with the farmer's contact and every offer sent (the supply-gap record). */
  app.get(
    '/v1/admin/bookings/:id',
    { config: { access: access.admin('support') } },
    async (req) => {
      const { id } = parseInput(bookingParams, req.params);
      const [b] = await ctx.db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
      if (!b) throw new DomainError('not_found');
      const [[view], [farmer], offers] = await Promise.all([
        farmerViews(ctx.db, [b]),
        ctx.db
          .select({ name: users.name, phone: users.phone })
          .from(users)
          .where(eq(users.id, b.farmerId)),
        ctx.db
          .select({
            id: bookingOffers.id,
            vetId: bookingOffers.vetId,
            wave: bookingOffers.wave,
            channel: bookingOffers.channel,
            sentAt: bookingOffers.sentAt,
            respondedAt: bookingOffers.respondedAt,
            response: bookingOffers.response,
          })
          .from(bookingOffers)
          .where(eq(bookingOffers.bookingId, id))
          .orderBy(bookingOffers.id),
      ]);
      return { ...view, farmer: farmer ?? null, offers };
    },
  );

  /** Cancel a booking. Can lead to a refund, so it needs a fresh step-up; audit-logged. */
  app.post(
    '/v1/admin/bookings/:id/cancel',
    { config: { access: access.admin('support', { stepUp: true }) } },
    async (req) => {
      const auth = authOf(req);
      const { id } = parseInput(bookingParams, req.params);
      const { reason } = parseInput(cancelBody, req.body);
      const booking = await cancelByAdmin(ctx, id, auth.userId, reason);
      await audit(
        ctx.db,
        {
          actorUserId: auth.userId,
          action: 'booking.cancelled',
          entity: 'booking',
          entityId: String(id),
          meta: { reason },
        },
        ctx.clock(),
      );
      const [view] = await farmerViews(ctx.db, [booking]);
      return view;
    },
  );
}
