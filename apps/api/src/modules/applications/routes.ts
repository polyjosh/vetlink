import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  ADMIN_ROLES,
  APPLICATION_DECISIONS,
  APPLICATION_REASONS,
  APPLICATION_STATUSES,
  APPLICATION_STEPS,
  DOCUMENT_CONTENT_TYPES,
  SPECIES,
  SPOKEN_LANGUAGES,
  VET_DOCUMENT_KINDS,
  VET_DOCUMENT_STATUSES,
  VET_SERVICES,
  VET_TYPES,
} from '@vetlink/shared';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { vetApplications, vets } from '../../db/schema/index.js';
import { DomainError } from '../../lib/errors.js';
import { intId, named, noContent, responses } from '../../schemas/common.js';
import { access, authOf } from '../auth/access.js';
import { getConfig } from '../config/service.js';
import {
  claimApplication,
  decideApplication,
  documentUrl,
  grantAdmin,
  listAdmins,
  reinstateVet,
  reviewDetail,
  reviewQueue,
  revokeAdmin,
  startAssistedApplication,
  suspendVet,
} from './review.js';
import {
  applicationView,
  confirmDocument,
  currentApplication,
  presignDocument,
  resubmitApplication,
  saveStep,
  startNewVersion,
  submitApplication,
  withdrawApplication,
} from './service.js';
import { STEP_PARTIAL } from './steps.js';

const application = named(
  z.object({
    id: z.number().int(),
    reference: z.string(),
    version: z.number().int(),
    status: z.enum(APPLICATION_STATUSES),
    createdVia: z.enum(['self', 'admin_assisted']),
    currentStep: z.number().int().describe('Resume the wizard here'),
    steps: z.record(z.enum(APPLICATION_STEPS), z.record(z.string(), z.unknown())),
    documents: z.array(
      z.object({
        id: z.number().int(),
        kind: z.enum(VET_DOCUMENT_KINDS),
        status: z.enum(VET_DOCUMENT_STATUSES),
        flagReason: z.string().nullable(),
      }),
    ),
    requiredDocuments: z.array(z.enum(VET_DOCUMENT_KINDS)),
    missing: z.object({
      fields: z.array(z.string()),
      documents: z.array(z.enum(VET_DOCUMENT_KINDS)),
    }),
    editable: z.enum(['all', 'flagged', 'none']),
    flaggedFields: z.array(z.string()).describe('`step.field` or `doc.<kind>` to fix'),
    decision: z
      .object({
        reasons: z.array(z.enum(APPLICATION_REASONS)),
        note: z.string().nullable(),
        decidedAt: z.string(),
      })
      .nullable(),
    submittedAt: z.string().nullable(),
    reviewTargetHours: z.number().int(),
  }),
  'VetApplication',
);

const reviewItem = named(
  z.object({
    id: z.number().int(),
    reference: z.string(),
    status: z.enum(APPLICATION_STATUSES),
    vetType: z.enum(VET_TYPES),
    name: z.string().nullable(),
    county: z.string().nullable(),
    ward: z.string().nullable(),
    resubmission: z.boolean(),
    assisted: z.boolean(),
    claimedBy: z.string().nullable(),
    submittedAt: z.string().nullable(),
    ageHours: z.number(),
    slaBreached: z.boolean(),
  }),
  'ApplicationQueueItem',
);

const reviewDetailSchema = named(
  application.extend({
    vetUserId: z.string(),
    applicant: z.object({ phone: z.string().nullable(), name: z.string().nullable() }),
    nationalId: z.string().nullable().describe('Highly sensitive: verifiers and super admins only'),
    createdBy: z.string().nullable(),
    claimedBy: z.string().nullable(),
    claimedAt: z.string().nullable(),
    internalNote: z.string().nullable(),
    checklist: z.unknown(),
    duplicates: z.array(
      z.object({ userId: z.string(), status: z.string(), matches: z.array(z.string()) }),
    ),
  }),
  'ApplicationReview',
);

const appParams = z.object({ id: intId });

export function applicationRoutes(app: FastifyInstance, ctx: AppContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ['vet application'];
  const vetOnly = { access: access.role('vet') };
  const view = async (userId: string) =>
    applicationView(ctx, await currentApplication(ctx, userId));

  r.get(
    '/v1/vets/me/application',
    {
      config: vetOnly,
      schema: {
        tags,
        summary: 'My application: saved draft, status, what is missing',
        response: responses({ 200: application }),
      },
    },
    async (req) => view(authOf(req).userId),
  );

  for (const step of APPLICATION_STEPS) {
    r.put(
      `/v1/vets/me/application/steps/${step}`,
      {
        config: vetOnly,
        schema: {
          tags,
          summary: `Autosave the "${step}" step (any subset of its fields)`,
          description: 'In changes_requested only the flagged fields may change (409 otherwise).',
          body: STEP_PARTIAL[step],
          response: responses({ 200: application }),
        },
      },
      async (req) => {
        await saveStep(ctx, authOf(req).userId, step, req.body);
        return view(authOf(req).userId);
      },
    );
  }

  r.post(
    '/v1/uploads/presign',
    {
      config: vetOnly,
      schema: {
        tags,
        summary: 'Get a URL to upload a document straight to private storage',
        description:
          'PUT the file to `uploadUrl` with `headers`, then confirm with POST /v1/vets/me/application/documents.',
        body: z.object({
          purpose: z.literal('vet_document'),
          documentKind: z.enum(VET_DOCUMENT_KINDS),
          contentType: z.enum(DOCUMENT_CONTENT_TYPES),
          size: z.number().int().positive(),
        }),
        response: responses({
          200: named(
            z.object({
              uploadUrl: z.string(),
              storageKey: z.string(),
              headers: z.record(z.string(), z.string()),
              expiresAt: z.string(),
            }),
            'PresignedUpload',
          ),
        }),
      },
    },
    async (req) =>
      presignDocument(ctx, authOf(req).userId, {
        kind: req.body.documentKind,
        contentType: req.body.contentType,
        size: req.body.size,
      }),
  );

  r.post(
    '/v1/vets/me/application/documents',
    {
      config: vetOnly,
      schema: {
        tags,
        summary: 'Confirm an uploaded document (safe to retry)',
        body: z.object({ kind: z.enum(VET_DOCUMENT_KINDS), storageKey: z.string().max(300) }),
        response: responses({ 200: application }),
      },
    },
    async (req) => {
      await confirmDocument(ctx, authOf(req).userId, req.body, req.log);
      return view(authOf(req).userId);
    },
  );

  const action = (path: string, summary: string, fn: (userId: string) => Promise<unknown>) =>
    r.post(
      `/v1/vets/me/application/${path}`,
      { config: vetOnly, schema: { tags, summary, response: responses({ 200: application }) } },
      async (req) => {
        await fn(authOf(req).userId);
        return view(authOf(req).userId);
      },
    );
  action('submit', 'Submit for review (422 lists anything missing)', (u) =>
    submitApplication(ctx, u),
  );
  action(
    'withdraw',
    'Take a submitted application back to edit (until a reviewer claims it)',
    (u) => withdrawApplication(ctx, u),
  );
  action('resubmit', 'Send it back after fixing the flagged items', (u) =>
    resubmitApplication(ctx, u),
  );
  action(
    'new-version',
    'Approved vets: start a reviewed change of critical details (name, ID, KVB, licence, payout)',
    (u) => startNewVersion(ctx, u),
  );

  /** Non-critical edits apply at once (§8.3): fee within bands, radius, species, services, bio. */
  r.patch(
    '/v1/vets/me/profile',
    {
      config: vetOnly,
      schema: {
        tags: ['vet'],
        summary: 'Change non-critical profile details (applied immediately)',
        body: z
          .object({
            serviceRadiusKm: z.number().int().min(1),
            baseCallOutFee: z.number().int().min(0),
            specialties: z.array(z.enum(SPECIES)).min(1),
            services: z.array(z.enum(VET_SERVICES)).min(1),
            languages: z.array(z.enum(SPOKEN_LANGUAGES)).min(1),
            bio: z.string().trim().max(300),
          })
          .partial(),
        response: responses({ 204: noContent }),
      },
    },
    async (req, reply) => {
      const userId = authOf(req).userId;
      const [vet] = await ctx.db.select().from(vets).where(eq(vets.userId, userId));
      if (vet?.verificationStatus !== 'approved' && vet?.verificationStatus !== 'suspended') {
        throw new DomainError('application_locked'); // before approval, edit the application
      }
      const b = req.body;
      const bands = await getConfig(ctx, 'vets.feeBands');
      if (
        b.baseCallOutFee !== undefined &&
        (b.baseCallOutFee < bands.min || b.baseCallOutFee > bands.max)
      ) {
        throw new DomainError('invalid_request', {
          fields: ['baseCallOutFee'],
          min: bands.min,
          max: bands.max,
        });
      }
      if (
        b.serviceRadiusKm !== undefined &&
        b.serviceRadiusKm > (await getConfig(ctx, 'vets.maxServiceRadiusKm'))
      ) {
        throw new DomainError('invalid_request', { fields: ['serviceRadiusKm'] });
      }
      await ctx.db
        .update(vets)
        .set({
          ...(b.serviceRadiusKm !== undefined && { serviceRadiusKm: b.serviceRadiusKm }),
          ...(b.baseCallOutFee !== undefined && { baseCallOutFee: b.baseCallOutFee }),
          ...(b.specialties && { specialties: b.specialties }),
          ...(b.services && { services: b.services }),
          ...(b.languages && { languages: b.languages }),
          ...(b.bio !== undefined && { bio: b.bio }),
        })
        .where(eq(vets.userId, userId));
      return reply.code(204).send(null);
    },
  );

  // ---- Admin: verification (§13) ----
  const adminTags = ['admin: verification'];

  r.get(
    '/v1/admin/vet-applications',
    {
      config: { access: access.admin('verifier') },
      schema: {
        tags: adminTags,
        summary: 'Review queue: resubmissions first, then oldest, with SLA',
        querystring: z.object({
          status: z.enum(['submitted', 'under_review']).optional(),
          county: z.string().max(60).optional(),
          type: z.enum(VET_TYPES).optional(),
          resubmission: z.enum(['true', 'false']).optional(),
        }),
        response: responses({ 200: z.array(reviewItem) }),
      },
    },
    async (req) =>
      reviewQueue(ctx, {
        ...(req.query.status && { status: req.query.status }),
        ...(req.query.county && { county: req.query.county }),
        ...(req.query.type && { type: req.query.type }),
        ...(req.query.resubmission && { resubmission: req.query.resubmission === 'true' }),
      }),
  );

  r.get(
    '/v1/admin/vet-applications/:id',
    {
      config: { access: access.admin('verifier') },
      schema: {
        tags: adminTags,
        summary: 'Application details, decrypted ID, duplicate flags',
        params: appParams,
        response: responses({ 200: reviewDetailSchema }),
      },
    },
    async (req) => reviewDetail(ctx, req.params.id),
  );

  r.post(
    '/v1/admin/vet-applications/:id/claim',
    {
      config: { access: access.admin('verifier') },
      schema: {
        tags: adminTags,
        summary: 'Claim for review (super admins may take over with force)',
        params: appParams,
        body: z.object({ force: z.boolean().default(false) }),
        response: responses({ 204: noContent }),
      },
    },
    async (req, reply) => {
      await claimApplication(ctx, req.params.id, authOf(req), req.body.force);
      return reply.code(204).send(null);
    },
  );

  r.post(
    '/v1/admin/vet-applications/:id/decision',
    {
      config: { access: access.admin('verifier') },
      schema: {
        tags: adminTags,
        summary: 'Approve, request changes, or reject (audited; four-eyes)',
        params: appParams,
        body: z.object({
          decision: z.enum(APPLICATION_DECISIONS),
          reasons: z.array(z.enum(APPLICATION_REASONS)).default([]),
          note: z.string().trim().max(500).optional(),
          internalNote: z.string().trim().max(1000).optional(),
          flaggedFields: z
            .array(z.string().regex(/^(doc\.[a-z_]+|[a-z_]+\.[A-Za-z]+)$/))
            .max(30)
            .optional(),
          checklist: z
            .record(
              z.string().max(40),
              z.object({ ok: z.boolean(), note: z.string().max(300).optional() }),
            )
            .optional(),
        }),
        response: responses({ 204: noContent }),
      },
    },
    async (req, reply) => {
      await decideApplication(ctx, req.params.id, authOf(req), req.body);
      return reply.code(204).send(null);
    },
  );

  r.get(
    '/v1/admin/vet-documents/:id/url',
    {
      config: { access: access.admin('verifier') },
      schema: {
        tags: adminTags,
        summary: 'A 5-minute link to view a document (every view is logged)',
        params: appParams,
        response: responses({ 200: z.object({ url: z.string(), expiresAt: z.string() }) }),
      },
    },
    async (req) => documentUrl(ctx, req.params.id, authOf(req).userId, req.log),
  );

  r.post(
    '/v1/admin/vets/:userId/suspend',
    {
      config: { access: access.admin('verifier', { stepUp: true }) },
      schema: {
        tags: adminTags,
        summary: 'Suspend an approved vet: offline at once, open offers withdrawn (audited)',
        params: z.object({ userId: z.uuid() }),
        body: z.object({
          reasons: z.array(z.enum(APPLICATION_REASONS)).min(1),
          note: z.string().max(500).optional(),
        }),
        response: responses({ 204: noContent }),
      },
    },
    async (req, reply) => {
      await suspendVet(ctx, req.params.userId, req.body, authOf(req).userId);
      return reply.code(204).send(null);
    },
  );

  r.post(
    '/v1/admin/vets/:userId/reinstate',
    {
      config: { access: access.admin('verifier', { stepUp: true }) },
      schema: {
        tags: adminTags,
        summary: 'Lift a suspension (the vet goes online themselves; audited)',
        params: z.object({ userId: z.uuid() }),
        body: z.object({ note: z.string().min(3).max(500) }),
        response: responses({ 204: noContent }),
      },
    },
    async (req, reply) => {
      await reinstateVet(ctx, req.params.userId, authOf(req).userId, req.body.note);
      return reply.code(204).send(null);
    },
  );

  r.post(
    '/v1/admin/vet-applications',
    {
      config: { access: access.admin('verifier') },
      schema: {
        tags: adminTags,
        summary:
          'Assisted onboarding: start an application for a vet (they consent and submit themselves)',
        body: z.object({
          phone: z.string().max(32),
          vetType: z.enum(VET_TYPES),
          name: z.string().max(100).optional(),
        }),
        response: responses({
          201: z.object({
            applicationId: z.number().int(),
            vetUserId: z.string(),
            reference: z.string(),
          }),
        }),
      },
    },
    async (req, reply) =>
      reply.code(201).send(await startAssistedApplication(ctx, authOf(req), req.body)),
  );

  for (const step of APPLICATION_STEPS) {
    r.put(
      `/v1/admin/vet-applications/:id/steps/${step}`,
      {
        config: { access: access.admin('verifier') },
        schema: {
          tags: adminTags,
          summary: `Assisted onboarding: fill the "${step}" step (the admin who started it, in draft)`,
          params: appParams,
          body: STEP_PARTIAL[step],
          response: responses({ 204: noContent }),
        },
      },
      async (req, reply) => {
        const [row] = await ctx.db
          .select({ vetUserId: vetApplications.vetUserId })
          .from(vetApplications)
          .where(eq(vetApplications.id, req.params.id));
        if (!row) throw new DomainError('not_found');
        await saveStep(ctx, row.vetUserId, step, req.body, { asAdmin: authOf(req).userId });
        return reply.code(204).send(null);
      },
    );
  }

  // ---- Admin: who is an admin (super admin only) ----
  r.get(
    '/v1/admin/admins',
    {
      config: { access: access.admin('super_admin') },
      schema: {
        tags: ['admin'],
        summary: 'Admins and their roles',
        response: responses({
          200: z.array(
            z.object({
              userId: z.string(),
              role: z.enum(ADMIN_ROLES),
              name: z.string().nullable(),
              phone: z.string().nullable(),
              totpEnabled: z.boolean(),
              grantedAt: z.string(),
              revokedAt: z.string().nullable(),
            }),
          ),
        }),
      },
    },
    async () =>
      (await listAdmins(ctx)).map((a) => ({
        ...a,
        grantedAt: a.grantedAt.toISOString(),
        revokedAt: a.revokedAt ? a.revokedAt.toISOString() : null,
      })),
  );

  r.post(
    '/v1/admin/admins',
    {
      config: { access: access.admin('super_admin', { stepUp: true }) },
      schema: {
        tags: ['admin'],
        summary:
          'Grant an admin role to a signed-up user (opens 72 h authenticator enrolment; audited)',
        body: z.object({ phone: z.string().max(32), role: z.enum(ADMIN_ROLES) }),
        response: responses({
          200: z.object({
            userId: z.string(),
            role: z.enum(ADMIN_ROLES),
            enrolExpiresAt: z.string(),
          }),
        }),
      },
    },
    async (req) => grantAdmin(ctx, authOf(req), req.body),
  );

  r.delete(
    '/v1/admin/admins/:userId',
    {
      config: { access: access.admin('super_admin', { stepUp: true }) },
      schema: {
        tags: ['admin'],
        summary: 'Revoke admin access (audited)',
        params: z.object({ userId: z.uuid() }),
        response: responses({ 204: noContent }),
      },
    },
    async (req, reply) => {
      await revokeAdmin(ctx, authOf(req), req.params.userId);
      return reply.code(204).send(null);
    },
  );
}
