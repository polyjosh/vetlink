import { and, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  KVB_CATEGORIES,
  PRACTICE_TYPES,
  PRICED_ITEMS,
  SPECIES,
  SPOKEN_LANGUAGES,
  VERIFICATION_STATUSES,
  VET_DOCUMENT_KINDS,
  VET_DOCUMENT_STATUSES,
  VET_SERVICES,
  VET_TYPES,
  type VetService,
  type WorkingHours,
} from '@vetlink/shared';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { locations, vetApplications, vetDocuments, vets } from '../../db/schema/index.js';
import { fieldContext } from '../../lib/crypto.js';
import { DomainError } from '../../lib/errors.js';
import { intId, named, responses } from '../../schemas/common.js';
import { audit } from '../admin/audit.js';
import { DOCUMENT_URL_TTL_S } from '../applications/review.js';
import { access, authOf } from '../auth/access.js';
import { getConfig } from '../config/service.js';
import { wardView } from '../users/schemas.js';
import {
  loadPractice,
  practiceFields,
  practiceProblems,
  workingHoursSchema,
  writeServiceFees,
} from './practice.js';
import { setAvailability } from './service.js';

const band = z.object({ min: z.number().int(), max: z.number().int() });

const vetProfile = named(
  z.object({
    type: z.enum(VET_TYPES),
    verificationStatus: z.enum(VERIFICATION_STATUSES),
    isAvailable: z.boolean(),
    shareLiveLocation: z.boolean(),
    ward: wardView.nullable(),
    serviceRadiusKm: z.number().int(),
    baseCallOutFee: z.number().int().nullable().describe('Call-out fee: the trip to the farm'),
    specialties: z.array(z.enum(SPECIES)),
    services: z.array(z.enum(VET_SERVICES)),
    rating: z.number().nullable(),
    // §24.3: prices and practice.
    consultationFee: z.number().int().nullable(),
    serviceFees: z.partialRecord(z.enum(VET_SERVICES), z.number().int()),
    offersCallOuts: z.boolean(),
    hasPremises: z.boolean(),
    premisesWard: wardView.nullable(),
    premisesDirections: z.string().nullable(),
    premisesHours: z.string().nullable(),
    workingHours: workingHoursSchema.nullable(),
    /** Fields still missing before the vet can go online (empty when complete). */
    practiceMissing: z.array(z.string()),
    bands: z.object({
      callOut: band,
      items: z.partialRecord(z.enum(PRICED_ITEMS), band),
      bookingFee: z.number().int().describe("VetLink's fee, part of every total"),
    }),
    // §24.3: what the vet submitted for verification (the national ID only as its last digits).
    qualifications: z.object({
      kvbRegNo: z.string().nullable(),
      kvbCategory: z.enum(KVB_CATEGORIES).nullable(),
      licenceExpiry: z.string().nullable(),
      qualification: z.string().nullable(),
      institution: z.string().nullable(),
      yearQualified: z.number().int().nullable(),
      practiceType: z.enum(PRACTICE_TYPES).nullable(),
      practiceName: z.string().nullable(),
      yearsExperience: z.number().int().nullable(),
      languages: z.array(z.enum(SPOKEN_LANGUAGES)),
      bio: z.string().nullable(),
      nationalIdLast3: z.string().nullable(),
      verifiedAt: z.string().nullable(),
    }),
    documents: z.array(
      z.object({
        id: z.number().int(),
        kind: z.enum(VET_DOCUMENT_KINDS),
        status: z.enum(VET_DOCUMENT_STATUSES),
        expiresAt: z.string().nullable(),
      }),
    ),
  }),
  'VetProfile',
);

const wardOf = (w: typeof locations.$inferSelect | null | undefined) =>
  w ? { id: w.id, ward: w.ward, subCounty: w.subCounty, county: w.county } : null;
const only = <T extends string>(all: readonly T[], values: readonly string[]): T[] =>
  values.filter((v): v is T => (all as readonly string[]).includes(v));

async function loadVet(ctx: AppContext, userId: string): Promise<z.infer<typeof vetProfile>> {
  const practice = await loadPractice(ctx, userId);
  if (!practice) throw new DomainError('not_found');
  const v = practice.vet;
  const wardIds = [v.wardId, v.premisesWardId].filter((id): id is number => id !== null);
  const wards = wardIds.length
    ? await ctx.db.select().from(locations).where(inArray(locations.id, wardIds))
    : [];
  const wardById = new Map(wards.map((w) => [w.id, w]));
  // The documents of the newest application version.
  const [latest] = await ctx.db
    .select({ id: vetApplications.id })
    .from(vetApplications)
    .where(eq(vetApplications.vetUserId, userId))
    .orderBy(desc(vetApplications.version))
    .limit(1);
  const docs = latest
    ? await ctx.db
        .select()
        .from(vetDocuments)
        .where(and(eq(vetDocuments.vetUserId, userId), eq(vetDocuments.applicationId, latest.id)))
        .orderBy(vetDocuments.id)
    : [];
  const [callOutBands, itemBands, bookingFee] = await Promise.all([
    getConfig(ctx, 'vets.feeBands'),
    getConfig(ctx, 'fees.serviceBands'),
    getConfig(ctx, 'payments.bookingFeeKes'),
  ]);
  const services = only(VET_SERVICES, v.services);
  const nationalId = v.nationalIdEnc
    ? ctx.crypto.decrypt(v.nationalIdEnc, fieldContext('vets.national_id', userId))
    : null;
  return {
    type: v.type,
    verificationStatus: v.verificationStatus,
    isAvailable: v.isAvailable,
    shareLiveLocation: v.shareLiveLocation,
    ward: wardOf(v.wardId === null ? null : wardById.get(v.wardId)),
    serviceRadiusKm: v.serviceRadiusKm,
    baseCallOutFee: v.baseCallOutFee,
    specialties: only(SPECIES, v.specialties),
    services,
    rating: v.rating === null ? null : Number(v.rating),
    consultationFee: v.consultationFee,
    serviceFees: practice.serviceFees,
    offersCallOuts: v.offersCallOuts,
    hasPremises: v.hasPremises,
    premisesWard: wardOf(v.premisesWardId === null ? null : wardById.get(v.premisesWardId)),
    premisesDirections: v.premisesDirections,
    premisesHours: v.premisesHours,
    workingHours: v.workingHours ?? null,
    practiceMissing: await practiceProblems(
      ctx,
      { ...v, services, serviceFees: practice.serviceFees },
      { complete: true },
    ),
    bands: { callOut: callOutBands, items: itemBands, bookingFee },
    qualifications: {
      kvbRegNo: v.kvbRegNo,
      kvbCategory: v.kvbCategory as (typeof KVB_CATEGORIES)[number] | null,
      licenceExpiry: v.licenceExpiry,
      qualification: v.qualification,
      institution: v.qualificationInstitution,
      yearQualified: v.qualificationYear,
      practiceType: v.practiceType,
      practiceName: v.practiceName,
      yearsExperience: v.yearsExperience,
      languages: only(SPOKEN_LANGUAGES, v.languages),
      bio: v.bio,
      nationalIdLast3: nationalId ? nationalId.slice(-3) : null,
      verifiedAt: v.verifiedAt ? v.verifiedAt.toISOString() : null,
    },
    documents: docs.map((d) => ({
      id: d.id,
      kind: d.kind,
      status: d.status,
      expiresAt: d.expiresAt,
    })),
  };
}

/** Non-critical edits (§8.3, §24.3): applied at once, but the result must stay complete. */
const practiceBody = z
  .object({
    serviceRadiusKm: z.number().int().min(1),
    baseCallOutFee: z.number().int().min(0),
    specialties: z.array(z.enum(SPECIES)).min(1),
    services: z.array(z.enum(VET_SERVICES)).min(1),
    languages: z.array(z.enum(SPOKEN_LANGUAGES)).min(1),
    bio: z.string().trim().max(300),
    ...practiceFields,
  })
  .partial();

export function vetRoutes(app: FastifyInstance, ctx: AppContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ['vet'];

  r.get(
    '/v1/vets/me',
    {
      config: { access: access.role('vet') },
      schema: {
        tags,
        summary: 'My vet profile: status, prices, practice, qualifications and documents',
        response: responses({ 200: vetProfile }),
      },
    },
    async (req) => loadVet(ctx, authOf(req).userId),
  );

  r.patch(
    '/v1/vets/me/profile',
    {
      config: { access: access.role('vet') },
      schema: {
        tags,
        summary: 'Change prices and practice details (approved vets; applied immediately)',
        description:
          'Prices must stay within the admin bands, every offered service needs a price, and at ' +
          'least one of call-outs or premises. Critical details (name, ID, KVB, licence, payout) ' +
          'go through a reviewed new application version instead.',
        body: practiceBody,
        response: responses({ 200: vetProfile }),
      },
    },
    async (req) => {
      const userId = authOf(req).userId;
      const current = await loadPractice(ctx, userId);
      if (!current) throw new DomainError('not_found');
      const v = current.vet;
      if (v.verificationStatus !== 'approved' && v.verificationStatus !== 'suspended') {
        throw new DomainError('application_locked'); // before approval, edit the application
      }
      const b = req.body;
      const callOutBands = await getConfig(ctx, 'vets.feeBands');
      if (
        b.baseCallOutFee !== undefined &&
        (b.baseCallOutFee < callOutBands.min || b.baseCallOutFee > callOutBands.max)
      ) {
        throw new DomainError('invalid_request', {
          fields: ['baseCallOutFee'],
          min: callOutBands.min,
          max: callOutBands.max,
        });
      }
      if (
        b.serviceRadiusKm !== undefined &&
        b.serviceRadiusKm > (await getConfig(ctx, 'vets.maxServiceRadiusKm'))
      ) {
        throw new DomainError('invalid_request', { fields: ['serviceRadiusKm'] });
      }
      const services: VetService[] = b.services ?? only(VET_SERVICES, v.services);
      const serviceFees = { ...current.serviceFees, ...b.serviceFees };
      const next = {
        services,
        consultationFee: b.consultationFee ?? v.consultationFee,
        serviceFees,
        offersCallOuts: b.offersCallOuts ?? v.offersCallOuts,
        hasPremises: b.hasPremises ?? v.hasPremises,
        premisesWardId: b.premisesWardId !== undefined ? b.premisesWardId : v.premisesWardId,
        baseCallOutFee: b.baseCallOutFee ?? v.baseCallOutFee,
      };
      const problems = await practiceProblems(ctx, next, { complete: true });
      if (problems.length) throw new DomainError('invalid_request', { fields: problems });
      await ctx.db.transaction(async (tx) => {
        await tx
          .update(vets)
          .set({
            ...(b.serviceRadiusKm !== undefined && { serviceRadiusKm: b.serviceRadiusKm }),
            ...(b.baseCallOutFee !== undefined && { baseCallOutFee: b.baseCallOutFee }),
            ...(b.specialties && { specialties: b.specialties }),
            ...(b.services && { services: b.services }),
            ...(b.languages && { languages: b.languages }),
            ...(b.bio !== undefined && { bio: b.bio }),
            consultationFee: next.consultationFee,
            offersCallOuts: next.offersCallOuts,
            hasPremises: next.hasPremises,
            premisesWardId: next.hasPremises ? next.premisesWardId : null,
            ...(b.premisesDirections !== undefined && {
              premisesDirections: b.premisesDirections,
            }),
            ...(b.premisesHours !== undefined && { premisesHours: b.premisesHours }),
            ...(b.workingHours && { workingHours: b.workingHours as WorkingHours }),
          })
          .where(eq(vets.userId, userId));
        await writeServiceFees(tx, userId, services, serviceFees);
      });
      return loadVet(ctx, userId);
    },
  );

  r.get(
    '/v1/vets/me/documents/:id/url',
    {
      config: { access: access.role('vet') },
      schema: {
        tags,
        summary: 'A short-lived link to one of my own documents (every view is logged)',
        params: z.object({ id: intId }),
        response: responses({ 200: z.object({ url: z.string(), expiresAt: z.string() }) }),
      },
    },
    async (req) => {
      const userId = authOf(req).userId;
      const [doc] = await ctx.db
        .select()
        .from(vetDocuments)
        .where(and(eq(vetDocuments.id, req.params.id), eq(vetDocuments.vetUserId, userId)));
      if (!doc) throw new DomainError('not_found');
      const now = ctx.clock();
      await audit(
        ctx.db,
        {
          actorUserId: userId,
          action: 'vet_document.viewed_by_owner',
          entity: 'vet_document',
          entityId: String(doc.id),
          meta: { kind: doc.kind },
        },
        now,
      );
      return {
        url: await ctx.storage.presignGet(doc.storageKey, DOCUMENT_URL_TTL_S),
        expiresAt: new Date(now.getTime() + DOCUMENT_URL_TTL_S * 1000).toISOString(),
      };
    },
  );

  r.patch(
    '/v1/vets/me/availability',
    {
      config: { access: access.role('vet') },
      schema: {
        tags,
        summary: 'Go online or offline (online only once approved, with prices set)',
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
