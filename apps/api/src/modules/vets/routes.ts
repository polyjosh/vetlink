import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { SPECIES, VERIFICATION_STATUSES, VET_SERVICES, VET_TYPES } from '@vetlink/shared';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { locations, vets } from '../../db/schema/index.js';
import { DomainError } from '../../lib/errors.js';
import { named, responses } from '../../schemas/common.js';
import { access, authOf } from '../auth/access.js';
import { wardView } from '../users/schemas.js';

const vetProfile = named(
  z.object({
    type: z.enum(VET_TYPES),
    verificationStatus: z.enum(VERIFICATION_STATUSES),
    isAvailable: z.boolean(),
    shareLiveLocation: z.boolean(),
    ward: wardView.nullable(),
    serviceRadiusKm: z.number().int(),
    baseCallOutFee: z.number().int().nullable(),
    specialties: z.array(z.enum(SPECIES)),
    services: z.array(z.enum(VET_SERVICES)),
    rating: z.number().nullable(),
  }),
  'VetProfile',
);

async function loadVet(ctx: AppContext, userId: string): Promise<z.infer<typeof vetProfile>> {
  const [row] = await ctx.db
    .select({ vet: vets, ward: locations })
    .from(vets)
    .leftJoin(locations, eq(locations.id, vets.wardId))
    .where(eq(vets.userId, userId))
    .limit(1);
  if (!row) throw new DomainError('not_found');
  const v = row.vet;
  return {
    type: v.type,
    verificationStatus: v.verificationStatus,
    isAvailable: v.isAvailable,
    shareLiveLocation: v.shareLiveLocation,
    ward: row.ward
      ? {
          id: row.ward.id,
          ward: row.ward.ward,
          subCounty: row.ward.subCounty,
          county: row.ward.county,
        }
      : null,
    serviceRadiusKm: v.serviceRadiusKm,
    baseCallOutFee: v.baseCallOutFee,
    specialties: v.specialties.filter((s): s is (typeof SPECIES)[number] =>
      (SPECIES as readonly string[]).includes(s),
    ),
    services: v.services.filter((s): s is (typeof VET_SERVICES)[number] =>
      (VET_SERVICES as readonly string[]).includes(s),
    ),
    rating: v.rating === null ? null : Number(v.rating),
  };
}

/**
 * Set a vet online or offline. Only an approved vet can go online (invariant 2; the database
 * CHECK backs this up). Going offline is always allowed.
 */
export async function setAvailability(ctx: AppContext, userId: string, isAvailable: boolean) {
  if (!isAvailable) {
    await ctx.db.update(vets).set({ isAvailable: false }).where(eq(vets.userId, userId));
    return;
  }
  // Conditional on approval in the same statement, so a suspension cannot slip in between.
  const updated = await ctx.db
    .update(vets)
    .set({ isAvailable: true })
    .where(and(eq(vets.userId, userId), eq(vets.verificationStatus, 'approved')))
    .returning({ userId: vets.userId });
  if (updated.length > 0) return;
  const [exists] = await ctx.db
    .select({ id: vets.userId })
    .from(vets)
    .where(eq(vets.userId, userId));
  throw new DomainError(exists ? 'vet_not_approved' : 'not_found');
}

export function vetRoutes(app: FastifyInstance, ctx: AppContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ['vet'];

  r.get(
    '/v1/vets/me',
    {
      config: { access: access.role('vet') },
      schema: {
        tags,
        summary: 'My vet profile and status',
        response: responses({ 200: vetProfile }),
      },
    },
    async (req) => loadVet(ctx, authOf(req).userId),
  );

  r.patch(
    '/v1/vets/me/availability',
    {
      config: { access: access.role('vet') },
      schema: {
        tags,
        summary: 'Go online or offline (online only once approved)',
        body: z.object({ isAvailable: z.boolean() }),
        response: responses({ 200: vetProfile }),
      },
    },
    async (req) => {
      const userId = authOf(req).userId;
      await setAvailability(ctx, userId, req.body.isAvailable);
      return loadVet(ctx, userId);
    },
  );

  r.put(
    '/v1/vets/me/location',
    {
      config: { access: access.role('vet') },
      schema: {
        tags,
        summary: 'Share my live location (opt-in; used for matching, never shown as a trail)',
        description: 'Older than 15 minutes, it is ignored and the base ward is used (§8.5, §17).',
        body: z.object({ lat: z.number().min(-5).max(6), lng: z.number().min(33).max(42.5) }),
        response: responses({ 200: vetProfile }),
      },
    },
    async (req) => {
      const userId = authOf(req).userId;
      await ctx.db
        .update(vets)
        .set({
          shareLiveLocation: true,
          liveLat: req.body.lat,
          liveLng: req.body.lng,
          liveLocationAt: ctx.clock(),
        })
        .where(eq(vets.userId, userId));
      return loadVet(ctx, userId);
    },
  );

  r.delete(
    '/v1/vets/me/location',
    {
      config: { access: access.role('vet') },
      schema: {
        tags,
        summary: 'Stop sharing live location (and forget the last one)',
        response: responses({ 200: vetProfile }),
      },
    },
    async (req) => {
      const userId = authOf(req).userId;
      await ctx.db
        .update(vets)
        .set({ shareLiveLocation: false, liveLat: null, liveLng: null, liveLocationAt: null })
        .where(eq(vets.userId, userId));
      return loadVet(ctx, userId);
    },
  );
}
