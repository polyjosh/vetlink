import { and, eq, isNotNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  PROBLEM_TYPES,
  SCHEDULE_PARTS,
  SPECIES,
  SPOKEN_LANGUAGES,
  VET_BADGES,
  VET_SERVICES,
  VET_TYPES,
  type VetService,
} from '@vetlink/shared';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { farmers, locations, users, vets } from '../../db/schema/index.js';
import { distanceKm } from '../../lib/geo.js';
import { DomainError } from '../../lib/errors.js';
import { intId, named, responses } from '../../schemas/common.js';
import { access, authOf } from '../auth/access.js';
import { getConfig } from '../config/service.js';
import { photoUrls } from '../media/service.js';
import { bookingPosition } from '../matching/candidates.js';
import { loadPractice } from '../vets/practice.js';
import { choosableForBooking, choosableVets, rechoose, switchToAuto } from './choose.js';
import { currentBookingFee } from './pricing.js';
import { recentVets } from './service.js';
import { farmerBooking, priceBreakdown } from './schemas.js';
import { farmerViews } from './views.js';

const sort = z.enum(['distance', 'rating', 'price']).optional();

const servicesParam = z
  .string()
  .optional()
  .describe('Comma-separated services added to the consultation')
  .transform((v, c) => {
    const parsed = z.array(z.enum(VET_SERVICES)).safeParse((v ?? '').split(',').filter(Boolean));
    if (!parsed.success) c.addIssue({ code: 'custom', message: 'unknown service' });
    return (parsed.data ?? []) as VetService[];
  });

export const choosableVet = named(
  z.object({
    vetId: z.string(),
    name: z.string().nullable().describe('Verified legal name'),
    displayName: z.string().nullable(),
    photoUrl: z.string().nullable(),
    type: z.enum(VET_TYPES),
    badges: z.array(z.enum(VET_BADGES)),
    rating: z.number().nullable().describe('null: new vet, no ratings yet'),
    distanceKm: z
      .number()
      .int()
      .describe('Whole km from the base or clinic, 0 = under 1 km; never live location'),
    price: priceBreakdown,
    languages: z.array(z.string()),
    yearsExperience: z.number().int().nullable(),
  }),
  'ChoosableVet',
);

const vetCard = named(
  z.object({
    vetId: z.string(),
    name: z.string().nullable(),
    displayName: z.string().nullable(),
    photoUrl: z.string().nullable(),
    type: z.enum(VET_TYPES),
    badges: z.array(z.enum(VET_BADGES)),
    rating: z.number().nullable(),
    species: z.array(z.enum(SPECIES)),
    consultationFee: z.number().int().nullable(),
    callOutFee: z.number().int().nullable(),
    serviceFees: z.partialRecord(z.enum(VET_SERVICES), z.number().int()),
    yearsExperience: z.number().int().nullable(),
    languages: z.array(z.enum(SPOKEN_LANGUAGES)),
    bio: z.string().nullable(),
    premises: z
      .object({ ward: z.string(), directions: z.string().nullable(), hours: z.string().nullable() })
      .nullable(),
  }),
  'VetCard',
);

const clinic = named(
  z.object({
    vetId: z.string(),
    name: z.string().nullable(),
    photoUrl: z.string().nullable(),
    badges: z.array(z.enum(VET_BADGES)),
    rating: z.number().nullable(),
    distanceKm: z.number().int(),
    ward: z.string(),
    directions: z.string().nullable(),
    hours: z.string().nullable(),
    /** A clinic is a public place: its location is given for directions (§24.3). */
    location: z.object({ lat: z.number(), lng: z.number() }),
  }),
  'Clinic',
);

/** §24.6: farmers choose their vet; §24.3: clinics near the farm. */
export function chooseRoutes(app: FastifyInstance, ctx: AppContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ['bookings (farmer)'];
  const farmerOnly = { access: access.role('farmer') };

  async function farmWard(userId: string, wardId?: number) {
    const [farmer] = await ctx.db.select().from(farmers).where(eq(farmers.userId, userId));
    const ward = wardId ?? farmer?.wardId;
    if (!ward) throw new DomainError('farmer_profile_required');
    return ward;
  }

  r.get(
    '/v1/vets/choose',
    {
      config: farmerOnly,
      schema: {
        tags,
        summary: 'Vets I can choose for a request (up to 20), with their price for it',
        description:
          'The same rules as matching: approved, online, call-outs, every added service, room ' +
          'for another job. Distance is rounded and never from live location (§24.6, §17).',
        querystring: z.object({
          species: z.enum(SPECIES),
          services: servicesParam,
          wardId: intId.optional(),
          lat: z.coerce.number().min(-5).max(6).optional(),
          lng: z.coerce.number().min(33).max(42.5).optional(),
          sort,
          date: z.iso.date().optional().describe('Book ahead (§24.10): with part'),
          part: z.enum(SCHEDULE_PARTS).optional(),
        }),
        response: responses({ 200: z.array(choosableVet) }),
      },
    },
    async (req) => {
      const q = req.query;
      return choosableVets(
        ctx,
        {
          species: q.species,
          services: q.services,
          wardId: await farmWard(authOf(req).userId, q.wardId),
          lat: q.lat ?? null,
          lng: q.lng ?? null,
          slot: q.date && q.part ? { date: q.date, part: q.part } : null,
        },
        { bookingFee: await currentBookingFee(ctx), ...(q.sort && { sort: q.sort }) },
      );
    },
  );

  r.get(
    '/v1/bookings/:id/vets',
    {
      config: farmerOnly,
      schema: {
        tags,
        summary: 'Vets I can choose again for this request (vets already asked are left out)',
        params: z.object({ id: intId }),
        querystring: z.object({ sort }),
        response: responses({ 200: z.array(choosableVet) }),
      },
    },
    async (req) => choosableForBooking(ctx, req.params.id, authOf(req).userId, req.query.sort),
  );

  r.post(
    '/v1/bookings/:id/rechoose',
    {
      config: farmerOnly,
      schema: {
        tags,
        summary: 'Ask another vet after the last one declined or did not answer',
        params: z.object({ id: intId }),
        body: z.object({ vetId: z.uuid() }),
        response: responses({ 200: farmerBooking }),
      },
    },
    async (req) => {
      const b = await rechoose(ctx, {
        bookingId: req.params.id,
        farmerId: authOf(req).userId,
        vetId: req.body.vetId,
        channel: req.headers['x-vetlink-channel'] === 'web' ? 'web' : 'app',
      });
      const [view] = await farmerViews(ctx, [b]);
      if (!view) throw new DomainError('not_found');
      return view;
    },
  );

  r.post(
    '/v1/bookings/:id/switch-to-auto',
    {
      config: farmerOnly,
      schema: {
        tags,
        summary: 'Stop choosing: pay the booking fee and let the fastest available vet take it',
        description: 'Then pay with POST /v1/payments/stk, as for any automatic booking.',
        params: z.object({ id: intId }),
        response: responses({ 200: farmerBooking }),
      },
    },
    async (req) => {
      const b = await switchToAuto(ctx, {
        bookingId: req.params.id,
        farmerId: authOf(req).userId,
        channel: req.headers['x-vetlink-channel'] === 'web' ? 'web' : 'app',
      });
      const [view] = await farmerViews(ctx, [b]);
      if (!view) throw new DomainError('not_found');
      return view;
    },
  );

  r.get(
    '/v1/vets/:vetId/card',
    {
      config: farmerOnly,
      schema: {
        tags,
        summary: "A vet's profile as farmers see it (approved vets only)",
        description: 'Only what §8.3 "What farmers see" allows: never IDs, documents or payout.',
        params: z.object({ vetId: z.uuid() }),
        response: responses({ 200: vetCard }),
      },
    },
    async (req) => {
      const practice = await loadPractice(ctx, req.params.vetId);
      const v = practice?.vet;
      if (!practice || v?.verificationStatus !== 'approved') throw new DomainError('not_found');
      const [user] = await ctx.db
        .select({ name: users.name, displayName: users.displayName, avatar: users.avatarMediaId })
        .from(users)
        .where(eq(users.id, v.userId));
      const photos = await photoUrls(ctx, [user?.avatar]);
      const [premisesWard] = v.premisesWardId
        ? await ctx.db.select().from(locations).where(eq(locations.id, v.premisesWardId))
        : [];
      return {
        vetId: v.userId,
        name: user?.name ?? null,
        displayName: user?.displayName ?? null,
        photoUrl: (user?.avatar && photos.get(user.avatar)) ?? null,
        type: v.type,
        badges: v.badges,
        rating: v.rating === null ? null : Number(v.rating),
        species: v.specialties.filter((s): s is (typeof SPECIES)[number] =>
          (SPECIES as readonly string[]).includes(s),
        ),
        consultationFee: v.consultationFee,
        callOutFee: v.offersCallOuts ? v.baseCallOutFee : null,
        serviceFees: practice.serviceFees,
        yearsExperience: v.yearsExperience,
        languages: v.languages.filter((l): l is (typeof SPOKEN_LANGUAGES)[number] =>
          (SPOKEN_LANGUAGES as readonly string[]).includes(l),
        ),
        bio: v.bio,
        premises:
          v.hasPremises && premisesWard
            ? {
                ward: premisesWard.ward,
                directions: v.premisesDirections,
                hours: v.premisesHours,
              }
            : null,
      };
    },
  );

  r.get(
    '/v1/vets/clinics',
    {
      config: farmerOnly,
      schema: {
        tags,
        summary: 'Clinics and agrovets near the farm that farmers can visit (§24.3)',
        querystring: z.object({
          wardId: intId.optional(),
          lat: z.coerce.number().min(-5).max(6).optional(),
          lng: z.coerce.number().min(33).max(42.5).optional(),
        }),
        response: responses({ 200: z.array(clinic) }),
      },
    },
    async (req) => {
      const q = req.query;
      const farm = await bookingPosition(ctx, {
        species: 'other',
        wardId: await farmWard(authOf(req).userId, q.wardId),
        lat: q.lat ?? null,
        lng: q.lng ?? null,
      });
      if (!farm) return [];
      const radiusKm = await getConfig(ctx, 'matching.maxRadiusKm');
      const rows = await ctx.db
        .select({
          vet: vets,
          ward: locations,
          name: users.name,
          avatar: users.avatarMediaId,
        })
        .from(vets)
        .innerJoin(users, eq(users.id, vets.userId))
        .innerJoin(locations, eq(locations.id, vets.premisesWardId))
        .where(
          and(
            eq(vets.verificationStatus, 'approved'),
            eq(vets.hasPremises, true),
            isNotNull(vets.premisesWardId),
          ),
        );
      const photos = await photoUrls(
        ctx,
        rows.map((r) => r.avatar),
      );
      return rows
        .map((r) => {
          const location =
            r.vet.premisesLat !== null && r.vet.premisesLng !== null
              ? { lat: r.vet.premisesLat, lng: r.vet.premisesLng }
              : r.ward.lat !== null && r.ward.lng !== null
                ? { lat: r.ward.lat, lng: r.ward.lng }
                : null;
          return { r, location };
        })
        .filter((x): x is typeof x & { location: { lat: number; lng: number } } => !!x.location)
        .map(({ r, location }) => ({
          vetId: r.vet.userId,
          name: r.name,
          photoUrl: (r.avatar && photos.get(r.avatar)) ?? null,
          badges: r.vet.badges,
          rating: r.vet.rating === null ? null : Number(r.vet.rating),
          distanceKm: Math.round(distanceKm(farm, location)),
          ward: r.ward.ward,
          directions: r.vet.premisesDirections,
          hours: r.vet.premisesHours,
          location,
        }))
        .filter((c) => c.distanceKm <= radiusKm)
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, 20);
    },
  );

  r.get(
    '/v1/farmers/me/recent-vets',
    {
      config: farmerOnly,
      schema: {
        tags,
        summary: 'Vets I finished jobs with, most recent first, for "Book again" (§24.9)',
        response: responses({
          200: z.array(
            named(
              z.object({
                vetId: z.string(),
                name: z.string().nullable(),
                photoUrl: z.string().nullable(),
                lastBookingId: z.number().int(),
                animalId: z.string().nullable(),
                species: z.enum(SPECIES),
                problemType: z.enum(PROBLEM_TYPES),
                available: z.boolean().describe('Can be asked right now'),
              }),
              'RecentVet',
            ),
          ),
        }),
      },
    },
    async (req) => recentVets(ctx, authOf(req).userId),
  );
}
