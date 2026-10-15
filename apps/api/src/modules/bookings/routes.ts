import type { FastifyInstance, FastifyRequest } from 'fastify';
import { CANCEL_REASONS, PROBLEM_TYPES, SPECIES, type Channel } from '@vetlink/shared';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { DomainError, parseInput } from '../../lib/errors.js';
import { access, authOf } from '../auth/access.js';
import {
  acceptOffer,
  cancelByFarmer,
  completeByVet,
  createBooking,
  declineOffer,
  listFarmerBookings,
  listVetJobs,
  rateBooking,
  releaseByVet,
  vetStep,
  viewBooking,
} from './service.js';
import { farmerViews, openOffersFor, vetJobViews } from './views.js';

const id = z.coerce.number().int().positive().max(2_147_483_647);
const bookingParams = z.object({ id });
const offerParams = z.object({ id, offerId: id });

const schemas = {
  create: z.object({
    species: z.enum(SPECIES),
    problemType: z.enum(PROBLEM_TYPES),
    isEmergency: z.boolean().default(false),
    animalId: z.uuid().optional(),
    note: z.string().trim().max(500).optional(),
    wardId: id.optional(),
    lat: z.number().min(-5).max(6).optional(), // Kenya's latitude range, with margin
    lng: z.number().min(33).max(42.5).optional(),
  }),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_:-]{8,128}$/),
  list: z.object({
    as: z.enum(['farmer', 'vet']).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    before: id.optional(),
  }),
  cancel: z.object({ reason: z.enum(CANCEL_REASONS) }),
  rating: z.object({
    stars: z.number().int().min(1).max(5),
    comment: z.string().max(500).optional(),
  }),
  step: z.object({ status: z.enum(['en_route', 'in_service']) }),
  complete: z.object({
    diagnosis: z.string().max(200).optional(),
    diagnosisCode: z
      .string()
      .regex(/^[a-z0-9_]{1,64}$/)
      .optional(),
    drugsUsed: z.string().max(500).optional(),
    notes: z.string().max(2000).optional(),
    followUpDate: z.iso.date().optional(),
    clientCreatedAt: z.iso.datetime().optional(),
  }),
};

/**
 * Which client made a REST call. Analytics and the event log only; never used for access.
 * Clients send `X-VetLink-Channel: app` (mobile) or `web`.
 */
export function restChannel(req: FastifyRequest): Channel {
  return req.headers['x-vetlink-channel'] === 'app' ? 'app' : 'web';
}

export function bookingRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/v1/bookings', { config: { access: access.role('farmer') } }, async (req, reply) => {
    const auth = authOf(req);
    const key = schemas.idempotencyKey.safeParse(req.headers['idempotency-key']);
    if (!key.success) throw new DomainError('idempotency_key_required');
    const body = parseInput(schemas.create, req.body);
    const { booking, created } = await createBooking(ctx, {
      ...body,
      farmerId: auth.userId,
      channel: restChannel(req),
      idempotencyKey: key.data,
    });
    const [view] = await farmerViews(ctx.db, [booking]);
    return reply.code(created ? 201 : 200).send(view);
  });

  app.get('/v1/bookings', { config: { access: access.user } }, async (req) => {
    const auth = authOf(req);
    const q = parseInput(schemas.list, req.query);
    // A farmer-and-vet user says which list they want; otherwise their one role decides.
    const as = q.as ?? (auth.roles.includes('farmer') ? 'farmer' : 'vet');
    if (!auth.roles.includes(as)) throw new DomainError('forbidden');
    const page = { limit: q.limit, before: q.before };
    return as === 'farmer'
      ? listFarmerBookings(ctx, auth.userId, page)
      : listVetJobs(ctx, auth.userId, page);
  });

  app.get('/v1/bookings/:id', { config: { access: access.user } }, async (req) => {
    const auth = authOf(req);
    const { id: bookingId } = parseInput(bookingParams, req.params);
    // Try each role the user holds; the service answers "not found" unless they own it.
    for (const kind of ['farmer', 'vet'] as const) {
      if (!auth.roles.includes(kind)) continue;
      try {
        return await viewBooking(ctx, bookingId, { kind, userId: auth.userId });
      } catch (err) {
        if (!(err instanceof DomainError && err.code === 'not_found')) throw err;
      }
    }
    throw new DomainError('not_found');
  });

  app.post(
    '/v1/bookings/:id/cancel',
    { config: { access: access.role('farmer') } },
    async (req) => {
      const auth = authOf(req);
      const { id: bookingId } = parseInput(bookingParams, req.params);
      const { reason } = parseInput(schemas.cancel, req.body);
      const booking = await cancelByFarmer(
        ctx,
        bookingId,
        { userId: auth.userId, channel: restChannel(req) },
        reason,
      );
      const [view] = await farmerViews(ctx.db, [booking]);
      return view;
    },
  );

  app.post(
    '/v1/bookings/:id/rating',
    { config: { access: access.role('farmer') } },
    async (req, reply) => {
      const auth = authOf(req);
      const { id: bookingId } = parseInput(bookingParams, req.params);
      const body = parseInput(schemas.rating, req.body);
      await rateBooking(ctx, bookingId, auth.userId, body);
      return reply.code(204).send();
    },
  );

  // ---- Vet ----

  app.get('/v1/vets/me/offers', { config: { access: access.role('vet') } }, async (req) =>
    openOffersFor(ctx.db, authOf(req).userId),
  );

  app.post(
    '/v1/bookings/:id/offers/:offerId/accept',
    { config: { access: access.role('vet') } },
    async (req) => {
      const auth = authOf(req);
      const p = parseInput(offerParams, req.params);
      const booking = await acceptOffer(ctx, {
        offerId: p.offerId,
        bookingId: p.id,
        vetId: auth.userId,
        channel: restChannel(req),
      });
      const [view] = await vetJobViews(ctx.db, [booking]);
      return view;
    },
  );

  app.post(
    '/v1/bookings/:id/offers/:offerId/decline',
    { config: { access: access.role('vet') } },
    async (req, reply) => {
      const auth = authOf(req);
      const p = parseInput(offerParams, req.params);
      await declineOffer(ctx, { offerId: p.offerId, bookingId: p.id, vetId: auth.userId });
      return reply.code(204).send();
    },
  );

  app.post('/v1/bookings/:id/status', { config: { access: access.role('vet') } }, async (req) => {
    const auth = authOf(req);
    const { id: bookingId } = parseInput(bookingParams, req.params);
    const { status } = parseInput(schemas.step, req.body);
    const booking = await vetStep(ctx, bookingId, status, {
      userId: auth.userId,
      channel: restChannel(req),
    });
    const [view] = await vetJobViews(ctx.db, [booking]);
    return view;
  });

  app.post(
    '/v1/bookings/:id/release',
    { config: { access: access.role('vet') } },
    async (req, reply) => {
      const auth = authOf(req);
      const { id: bookingId } = parseInput(bookingParams, req.params);
      await releaseByVet(ctx, bookingId, { userId: auth.userId, channel: restChannel(req) });
      return reply.code(204).send();
    },
  );

  app.post('/v1/bookings/:id/complete', { config: { access: access.role('vet') } }, async (req) => {
    const auth = authOf(req);
    const { id: bookingId } = parseInput(bookingParams, req.params);
    const body = parseInput(schemas.complete, req.body);
    const rawNotes =
      body.notes ??
      [body.diagnosis, body.drugsUsed].filter((x): x is string => Boolean(x)).join('; ');
    const booking = await completeByVet(
      ctx,
      bookingId,
      { userId: auth.userId, channel: restChannel(req) },
      {
        diagnosis: body.diagnosis,
        diagnosisCode: body.diagnosisCode,
        drugsUsed: body.drugsUsed,
        rawNotes,
        followUpDate: body.followUpDate,
        clientCreatedAt: body.clientCreatedAt ? new Date(body.clientCreatedAt) : undefined,
      },
    );
    const [view] = await vetJobViews(ctx.db, [booking]);
    return view;
  });
}
