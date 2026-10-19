import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { DEPOSIT_KES, SPECIES, type Channel } from '@vetlink/shared';
import { eq } from 'drizzle-orm';
import { farmers } from '../../db/schema/index.js';
import { quoteCallOutFee } from './pricing.js';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { DomainError } from '../../lib/errors.js';
import { intId, named, noContent, responses } from '../../schemas/common.js';
import { access, authOf } from '../auth/access.js';
import {
  bookingParams,
  cancelBody,
  completeBody,
  createBookingBody,
  farmerBooking,
  idempotencyHeaders,
  idempotencyKey,
  listQuery,
  offer,
  offerParams,
  ratingBody,
  stepBody,
  vetJob,
} from './schemas.js';
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

const channelHeader = z.object({ 'x-vetlink-channel': z.enum(['app', 'web']).optional() });

/**
 * Which client made a REST call. Analytics and the event log only; never used for access.
 * Clients send `X-VetLink-Channel: app` (mobile) or `web`.
 */
export function restChannel(req: FastifyRequest): Channel {
  return req.headers['x-vetlink-channel'] === 'app' ? 'app' : 'web';
}

const firstView = <T>(views: T[]): T => {
  const [view] = views;
  if (!view) throw new Error('view missing');
  return view;
};

export function bookingRoutes(app: FastifyInstance, ctx: AppContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const farmerTags = ['bookings (farmer)'];
  const vetTags = ['bookings (vet)'];

  r.post(
    '/v1/bookings',
    {
      config: { access: access.role('farmer') },
      schema: {
        tags: farmerTags,
        summary: 'Request a vet (created in pending_payment)',
        description:
          'Idempotent per farmer and `Idempotency-Key`: a retry returns the same booking with 200; ' +
          'the same key with a different request is 422. The fee is always quoted by the server.',
        headers: idempotencyHeaders,
        body: createBookingBody,
        response: responses({ 201: farmerBooking, 200: farmerBooking }),
      },
    },
    async (req, reply) => {
      const auth = authOf(req);
      const key = idempotencyKey.safeParse(req.headers['idempotency-key']);
      if (!key.success) throw new DomainError('idempotency_key_required');
      const { booking, created } = await createBooking(ctx, {
        ...req.body,
        farmerId: auth.userId,
        channel: restChannel(req),
        idempotencyKey: key.data,
      });
      return reply.code(created ? 201 : 200).send(firstView(await farmerViews(ctx, [booking])));
    },
  );

  r.get(
    '/v1/bookings/quote',
    {
      config: { access: access.role('farmer') },
      schema: {
        tags: farmerTags,
        summary: 'The call-out fee and deposit before confirming (§8.6: fees shown up front)',
        description:
          'The same server-side quote the booking will store. Defaults to the saved ward.',
        querystring: z.object({
          species: z.enum(SPECIES),
          wardId: intId.optional(),
          lat: z.coerce.number().min(-5).max(6).optional(),
          lng: z.coerce.number().min(33).max(42.5).optional(),
        }),
        response: responses({
          200: named(
            z.object({ feeQuoted: z.number().int(), depositKes: z.number().int() }),
            'Quote',
          ),
        }),
      },
    },
    async (req) => {
      const auth = authOf(req);
      const [farmer] = await ctx.db.select().from(farmers).where(eq(farmers.userId, auth.userId));
      const wardId = req.query.wardId ?? farmer?.wardId;
      if (!wardId) throw new DomainError('farmer_profile_required');
      return {
        feeQuoted: await quoteCallOutFee(ctx, {
          wardId,
          species: req.query.species,
          lat: req.query.lat ?? null,
          lng: req.query.lng ?? null,
        }),
        depositKes: DEPOSIT_KES,
      };
    },
  );

  r.get(
    '/v1/bookings',
    {
      config: { access: access.user },
      schema: {
        tags: farmerTags,
        summary: 'My bookings (farmer) or my jobs (vet), newest first',
        querystring: listQuery,
        response: responses({ 200: z.union([z.array(farmerBooking), z.array(vetJob)]) }),
      },
    },
    async (req) => {
      const auth = authOf(req);
      const q = req.query;
      // A farmer-and-vet user says which list they want; otherwise their one role decides.
      const as = q.as ?? (auth.roles.includes('farmer') ? 'farmer' : 'vet');
      if (!auth.roles.includes(as)) throw new DomainError('forbidden');
      const page = { limit: q.limit, before: q.before };
      return as === 'farmer'
        ? listFarmerBookings(ctx, auth.userId, page)
        : listVetJobs(ctx, auth.userId, page);
    },
  );

  r.get(
    '/v1/bookings/:id',
    {
      config: { access: access.user },
      schema: {
        tags: farmerTags,
        summary: 'One booking: the farmer view for its farmer, the job view for its vet',
        params: bookingParams,
        response: responses({ 200: z.union([farmerBooking, vetJob]) }),
      },
    },
    async (req) => {
      const auth = authOf(req);
      // Try each role the user holds; the service answers "not found" unless they own it.
      for (const kind of ['farmer', 'vet'] as const) {
        if (!auth.roles.includes(kind)) continue;
        try {
          return await viewBooking(ctx, req.params.id, { kind, userId: auth.userId });
        } catch (err) {
          if (!(err instanceof DomainError && err.code === 'not_found')) throw err;
        }
      }
      throw new DomainError('not_found');
    },
  );

  r.post(
    '/v1/bookings/:id/cancel',
    {
      config: { access: access.role('farmer') },
      schema: {
        tags: farmerTags,
        summary: 'Cancel (until the vet is with the animal; deposit forfeited after en_route)',
        headers: channelHeader,
        params: bookingParams,
        body: cancelBody,
        response: responses({ 200: farmerBooking }),
      },
    },
    async (req) => {
      const auth = authOf(req);
      const booking = await cancelByFarmer(
        ctx,
        req.params.id,
        { userId: auth.userId, channel: restChannel(req) },
        req.body.reason,
      );
      return firstView(await farmerViews(ctx, [booking]));
    },
  );

  r.post(
    '/v1/bookings/:id/rating',
    {
      config: { access: access.role('farmer') },
      schema: {
        tags: farmerTags,
        summary: 'Rate a completed visit (once; a retry with the same stars is fine)',
        params: bookingParams,
        body: ratingBody,
        response: responses({ 204: noContent }),
      },
    },
    async (req, reply) => {
      await rateBooking(ctx, req.params.id, authOf(req).userId, req.body);
      return reply.code(204).send(null);
    },
  );

  // ---- Vet ----

  r.get(
    '/v1/vets/me/offers',
    {
      config: { access: access.role('vet') },
      schema: {
        tags: vetTags,
        summary: 'Open job offers (no farmer identity until accepted)',
        response: responses({ 200: z.array(offer) }),
      },
    },
    async (req) => openOffersFor(ctx.db, authOf(req).userId),
  );

  r.post(
    '/v1/bookings/:id/offers/:offerId/accept',
    {
      config: { access: access.role('vet') },
      schema: {
        tags: vetTags,
        summary: 'Accept a job (first accept wins; 409 offer_taken otherwise)',
        headers: channelHeader,
        params: offerParams,
        response: responses({ 200: vetJob }),
      },
    },
    async (req) => {
      const booking = await acceptOffer(ctx, {
        offerId: req.params.offerId,
        bookingId: req.params.id,
        vetId: authOf(req).userId,
        channel: restChannel(req),
      });
      return firstView(await vetJobViews(ctx, [booking]));
    },
  );

  r.post(
    '/v1/bookings/:id/offers/:offerId/decline',
    {
      config: { access: access.role('vet') },
      schema: {
        tags: vetTags,
        summary: 'Decline a job offer',
        params: offerParams,
        response: responses({ 204: noContent }),
      },
    },
    async (req, reply) => {
      await declineOffer(ctx, {
        offerId: req.params.offerId,
        bookingId: req.params.id,
        vetId: authOf(req).userId,
      });
      return reply.code(204).send(null);
    },
  );

  r.post(
    '/v1/bookings/:id/status',
    {
      config: { access: access.role('vet') },
      schema: {
        tags: vetTags,
        summary: 'On my way (en_route) or arrived (in_service); safe to retry',
        headers: channelHeader,
        params: bookingParams,
        body: stepBody,
        response: responses({ 200: vetJob }),
      },
    },
    async (req) => {
      const booking = await vetStep(ctx, req.params.id, req.body.status, {
        userId: authOf(req).userId,
        channel: restChannel(req),
      });
      return firstView(await vetJobViews(ctx, [booking]));
    },
  );

  r.post(
    '/v1/bookings/:id/release',
    {
      config: { access: access.role('vet') },
      schema: {
        tags: vetTags,
        summary: 'Hand an accepted job back before setting off (it is dispatched again)',
        headers: channelHeader,
        params: bookingParams,
        response: responses({ 204: noContent }),
      },
    },
    async (req, reply) => {
      await releaseByVet(ctx, req.params.id, {
        userId: authOf(req).userId,
        channel: restChannel(req),
      });
      return reply.code(204).send(null);
    },
  );

  r.post(
    '/v1/bookings/:id/complete',
    {
      config: { access: access.role('vet') },
      schema: {
        tags: vetTags,
        summary: 'Complete the job with treatment notes (exactly once; safe to replay offline)',
        headers: channelHeader,
        params: bookingParams,
        body: completeBody,
        response: responses({ 200: vetJob }),
      },
    },
    async (req) => {
      const body = req.body;
      const rawNotes =
        body.notes ??
        [body.diagnosis, body.drugsUsed].filter((x): x is string => Boolean(x)).join('; ');
      const booking = await completeByVet(
        ctx,
        req.params.id,
        { userId: authOf(req).userId, channel: restChannel(req) },
        {
          diagnosis: body.diagnosis,
          diagnosisCode: body.diagnosisCode,
          drugsUsed: body.drugsUsed,
          rawNotes,
          followUpDate: body.followUpDate,
          clientCreatedAt: body.clientCreatedAt ? new Date(body.clientCreatedAt) : undefined,
        },
      );
      return firstView(await vetJobViews(ctx, [booking]));
    },
  );
}
