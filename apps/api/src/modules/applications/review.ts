import { and, asc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import {
  REVIEW_TARGET_HOURS,
  normalizePhone,
  type AdminRole,
  type ApplicationDecision,
  type ApplicationReason,
  type VetType,
} from '@vetlink/shared';
import type { AppContext } from '../../context.js';
import type { Tx } from '../../db/client.js';
import {
  adminProfiles,
  bookingOffers,
  locations,
  users,
  vetApplications,
  vetDocuments,
  vets,
} from '../../db/schema/index.js';
import { fieldContext } from '../../lib/crypto.js';
import { DomainError } from '../../lib/errors.js';
import { audit } from '../admin/audit.js';
import type { AuthContext } from '../auth/access.js';
import { TOTP_ENROL_WINDOW_MS } from '../auth/two-factor.js';
import { avatarFromApplication } from '../media/service.js';
import { applicationView, documentsOf, type ApplicationRow, vetTypeOf } from './service.js';
import type { StoredData } from './steps.js';

/** Document view links last this long, and every one is logged (§17). */
export const DOCUMENT_URL_TTL_S = 5 * 60;

const notifyVet = (
  ctx: AppContext,
  vetUserId: string,
  kind:
    | 'application_changes'
    | 'application_approved'
    | 'application_rejected'
    | 'vet_suspended'
    | 'vet_reinstated',
  params: Record<string, string | number>,
  jobKey: string,
) =>
  ctx.jobs.add(
    'notifications.send',
    { userId: vetUserId, kind, params },
    { jobId: `${kind}-${jobKey}` },
  );

/** The verification queue (§13): resubmissions first, then oldest; with review-time SLA. */
export async function reviewQueue(
  ctx: AppContext,
  filter: {
    status?: 'submitted' | 'under_review';
    county?: string;
    type?: VetType;
    resubmission?: boolean;
  },
) {
  const statuses = filter.status ? [filter.status] : (['submitted', 'under_review'] as const);
  const rows = await ctx.db
    .select({
      app: vetApplications,
      name: users.name,
      county: locations.county,
      ward: locations.ward,
    })
    .from(vetApplications)
    .innerJoin(users, eq(users.id, vetApplications.vetUserId))
    .leftJoin(
      locations,
      sql`${locations.id} = (${vetApplications.data} -> 'service_area' ->> 'wardId')::int`,
    )
    .where(inArray(vetApplications.status, [...statuses]))
    .orderBy(
      sql`(${vetApplications.flaggedFields} is null)`, // resubmissions (flagged before) first
      asc(vetApplications.submittedAt),
    );
  const now = ctx.clock().getTime();
  return rows
    .filter((r) => !filter.county || r.county === filter.county)
    .filter((r) => !filter.type || vetTypeOf(r.app) === filter.type)
    .filter(
      (r) =>
        filter.resubmission === undefined || (r.app.flaggedFields !== null) === filter.resubmission,
    )
    .map((r) => {
      const ageHours = r.app.submittedAt ? (now - r.app.submittedAt.getTime()) / 3_600_000 : 0;
      return {
        id: r.app.id,
        reference: r.app.reference,
        status: r.app.status,
        vetType: vetTypeOf(r.app),
        name: r.name,
        county: r.county,
        ward: r.ward,
        resubmission: r.app.flaggedFields !== null,
        assisted: r.app.createdVia === 'admin_assisted',
        claimedBy: r.app.claimedBy,
        submittedAt: r.app.submittedAt ? r.app.submittedAt.toISOString() : null,
        ageHours: Math.round(ageHours * 10) / 10,
        slaBreached: ageHours > REVIEW_TARGET_HOURS,
      };
    });
}

async function loadApp(ctx: AppContext, id: number): Promise<ApplicationRow> {
  const [app] = await ctx.db.select().from(vetApplications).where(eq(vetApplications.id, id));
  if (!app) throw new DomainError('not_found');
  return app;
}

/** Everything a verifier needs (§13), including the decrypted ID and duplicate flags. */
export async function reviewDetail(ctx: AppContext, id: number) {
  const app = await loadApp(ctx, id);
  const data = app.data as StoredData;
  const personal = data.personal ?? {};
  const [applicant] = await ctx.db
    .select({ phone: users.phone, name: users.name })
    .from(users)
    .where(eq(users.id, app.vetUserId));
  const nationalId =
    typeof personal.nationalIdEnc === 'string'
      ? ctx.crypto.decrypt(
          personal.nationalIdEnc,
          fieldContext('vet_applications.national_id', String(app.id)),
        )
      : null;

  // Duplicate check (§13 checklist 6): same ID, KVB number or phone on another vet.
  const kvb = data.credentials?.kvbRegNo;
  const payout = data.payout?.payoutMpesaPhone;
  const conditions = [
    typeof personal.nationalIdHash === 'string'
      ? eq(vets.nationalIdHash, personal.nationalIdHash)
      : undefined,
    typeof kvb === 'string' ? sql`upper(${vets.kvbRegNo}) = upper(${kvb})` : undefined,
    typeof payout === 'string' ? eq(vets.payoutMpesaPhone, payout) : undefined,
  ].filter((c) => c !== undefined);
  const dupVets = conditions.length
    ? await ctx.db
        .select({
          userId: vets.userId,
          status: vets.verificationStatus,
          kvb: vets.kvbRegNo,
          idHash: vets.nationalIdHash,
          payout: vets.payoutMpesaPhone,
        })
        .from(vets)
        .where(and(ne(vets.userId, app.vetUserId), or(...conditions)))
    : [];
  // Other applications with the same ID number (not yet copied to a vet profile).
  const dupApps =
    typeof personal.nationalIdHash === 'string'
      ? await ctx.db
          .select({ id: vetApplications.id, vetUserId: vetApplications.vetUserId })
          .from(vetApplications)
          .where(
            and(
              ne(vetApplications.vetUserId, app.vetUserId),
              sql`${vetApplications.data} -> 'personal' ->> 'nationalIdHash' = ${personal.nationalIdHash}`,
            ),
          )
      : [];
  const duplicates = [
    ...dupVets.map((d) => ({
      userId: d.userId,
      status: d.status,
      matches: [
        d.idHash && d.idHash === personal.nationalIdHash ? 'national_id' : null,
        d.kvb && typeof kvb === 'string' && d.kvb.toUpperCase() === kvb.toUpperCase()
          ? 'kvb'
          : null,
        d.payout && d.payout === payout ? 'payout_phone' : null,
      ].filter((m): m is string => m !== null),
    })),
    ...dupApps
      .filter((a) => !dupVets.some((v) => v.userId === a.vetUserId))
      .map((a) => ({
        userId: a.vetUserId,
        status: 'application' as const,
        matches: ['national_id'],
      })),
  ];

  return {
    ...(await applicationView(ctx, app)),
    vetUserId: app.vetUserId,
    applicant: { phone: applicant?.phone ?? null, name: applicant?.name ?? null },
    nationalId,
    createdBy: app.createdBy,
    claimedBy: app.claimedBy,
    claimedAt: app.claimedAt ? app.claimedAt.toISOString() : null,
    internalNote: app.internalNote,
    checklist: app.checklist,
    duplicates,
  };
}

/** Take an application for review so two verifiers never work on the same one. */
export async function claimApplication(
  ctx: AppContext,
  id: number,
  admin: AuthContext,
  force: boolean,
) {
  const now = ctx.clock();
  const app = await loadApp(ctx, id);
  if (app.status === 'under_review') {
    if (app.claimedBy === admin.userId) return app;
    if (!(force && admin.admin?.role === 'super_admin'))
      throw new DomainError('application_claimed');
  } else if (app.status !== 'submitted') {
    throw new DomainError('application_locked');
  }
  const claimed = await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .update(vetApplications)
      .set({ status: 'under_review', claimedBy: admin.userId, claimedAt: now })
      .where(
        and(
          eq(vetApplications.id, id),
          inArray(vetApplications.status, ['submitted', 'under_review']),
        ),
      )
      .returning();
    if (!row) throw new DomainError('application_locked');
    const [vet] = await tx
      .select({ status: vets.verificationStatus })
      .from(vets)
      .where(eq(vets.userId, row.vetUserId));
    if (vet && vet.status !== 'approved' && vet.status !== 'suspended') {
      await tx
        .update(vets)
        .set({ verificationStatus: 'under_review' })
        .where(eq(vets.userId, row.vetUserId));
    }
    return row;
  });
  await audit(
    ctx.db,
    {
      actorUserId: admin.userId,
      action: 'vet_application.claimed',
      entity: 'vet_application',
      entityId: String(id),
      meta: { force },
    },
    now,
  );
  return claimed;
}

export interface DecisionInput {
  decision: ApplicationDecision;
  reasons: ApplicationReason[];
  /** Shown to the vet. */
  note?: string | undefined;
  /** Admins only. */
  internalNote?: string | undefined;
  /** For request_changes: `step.field` or `doc.<kind>` the vet must fix. */
  flaggedFields?: string[] | undefined;
  checklist?: Record<string, { ok: boolean; note?: string | undefined }> | undefined;
}

/**
 * Decide an application under review (§13). Only the reviewer who claimed it decides, and the
 * admin who filled it in for the vet (assisted onboarding) can never approve it (four-eyes).
 */
export async function decideApplication(
  ctx: AppContext,
  id: number,
  admin: AuthContext,
  input: DecisionInput,
) {
  const app = await loadApp(ctx, id);
  if (app.status !== 'under_review') throw new DomainError('application_locked');
  if (app.claimedBy !== admin.userId) throw new DomainError('application_claimed');
  if (input.decision === 'approve' && app.createdBy === admin.userId) {
    throw new DomainError('forbidden', { reason: 'four_eyes' });
  }
  if (input.decision !== 'approve' && input.reasons.length === 0) {
    throw new DomainError('invalid_request', { fields: ['reasons'] });
  }
  if (input.decision === 'request_changes' && !input.flaggedFields?.length) {
    throw new DomainError('invalid_request', { fields: ['flaggedFields'] });
  }
  const now = ctx.clock();
  const status =
    input.decision === 'approve'
      ? 'approved'
      : input.decision === 'reject'
        ? 'rejected'
        : 'changes_requested';

  await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .update(vetApplications)
      .set({
        status,
        decidedBy: admin.userId,
        decidedAt: now,
        decisionReasons: input.reasons,
        decisionNote: input.note ?? null,
        internalNote: input.internalNote ?? app.internalNote,
        checklist: input.checklist ?? app.checklist,
        ...(input.decision === 'request_changes' && { flaggedFields: input.flaggedFields }),
      })
      .where(and(eq(vetApplications.id, id), eq(vetApplications.status, 'under_review')))
      .returning();
    if (!row) throw new DomainError('application_locked');

    if (input.decision === 'request_changes') {
      const flaggedDocs = (input.flaggedFields ?? [])
        .filter((f) => f.startsWith('doc.'))
        .map((f) => f.slice(4));
      if (flaggedDocs.length) {
        await tx
          .update(vetDocuments)
          .set({
            status: 'flagged',
            flagReason: input.note ?? null,
            reviewedBy: admin.userId,
            reviewedAt: now,
          })
          .where(
            and(
              eq(vetDocuments.applicationId, id),
              inArray(vetDocuments.kind, flaggedDocs as never[]),
            ),
          );
      }
    }
    if (input.decision === 'approve') {
      await applyApprovedApplication(tx, ctx, row, now);
      await avatarFromApplication(tx, ctx, row.vetUserId, row.id);
      await tx
        .update(vetDocuments)
        .set({ status: 'accepted', reviewedBy: admin.userId, reviewedAt: now })
        .where(eq(vetDocuments.applicationId, id));
      return;
    }
    // A first application's outcome is the vet's status; later versions leave an approved vet as is.
    const [vet] = await tx
      .select({ status: vets.verificationStatus })
      .from(vets)
      .where(eq(vets.userId, row.vetUserId));
    if (vet && vet.status !== 'approved' && vet.status !== 'suspended') {
      await tx
        .update(vets)
        .set({
          verificationStatus: status === 'rejected' ? 'rejected' : 'changes_requested',
          isAvailable: false,
        })
        .where(eq(vets.userId, row.vetUserId));
    }
  });

  await audit(
    ctx.db,
    {
      actorUserId: admin.userId,
      action: `vet_application.${input.decision}`,
      entity: 'vet_application',
      entityId: String(id),
      meta: { reasons: input.reasons, version: app.version },
    },
    now,
  );
  const kind =
    input.decision === 'approve'
      ? 'application_approved'
      : input.decision === 'reject'
        ? 'application_rejected'
        : 'application_changes';
  // A later version's approval is not news worth an "approved, go online" message.
  if (!(input.decision === 'approve' && app.version > 1)) {
    await notifyVet(ctx, app.vetUserId, kind, { ref: app.reference }, `${id}-${now.getTime()}`);
  }
}

/** Copy an approved application into the vet's live profile (what matching and farmers use). */
async function applyApprovedApplication(tx: Tx, ctx: AppContext, app: ApplicationRow, now: Date) {
  const d = app.data as StoredData;
  const p = d.personal ?? {};
  const c = d.credentials ?? {};
  const pr = d.practice ?? {};
  const sa = d.service_area ?? {};
  const nationalId =
    typeof p.nationalIdEnc === 'string'
      ? ctx.crypto.decrypt(
          p.nationalIdEnc,
          fieldContext('vet_applications.national_id', String(app.id)),
        )
      : null;
  const [current] = await tx.select().from(vets).where(eq(vets.userId, app.vetUserId));
  await tx
    .update(vets)
    .set({
      type: vetTypeOf(app),
      kvbRegNo: (c.kvbRegNo as string | undefined) ?? null,
      kvbCategory: (c.kvbCategory as string | undefined) ?? null,
      licenceExpiry: (c.licenceExpiry as string | undefined) ?? null,
      nationalIdEnc: nationalId
        ? ctx.crypto.encrypt(nationalId, fieldContext('vets.national_id', app.vetUserId))
        : null,
      nationalIdHash: (p.nationalIdHash as string | undefined) ?? null,
      qualification: (c.qualification as string | undefined) ?? null,
      qualificationInstitution: (c.institution as string | undefined) ?? null,
      qualificationYear: (c.yearQualified as number | undefined) ?? null,
      practiceType: (pr.practiceType as typeof vets.$inferInsert.practiceType) ?? null,
      practiceName: (pr.practiceName as string | undefined) ?? null,
      yearsExperience: (pr.yearsExperience as number | undefined) ?? null,
      specialties: (pr.species as string[] | undefined) ?? [],
      services: (pr.services as string[] | undefined) ?? [],
      languages: (pr.languages as string[] | undefined) ?? [],
      bio: (pr.bio as string | undefined) ?? null,
      payoutMpesaPhone: (d.payout?.payoutMpesaPhone as string | undefined) ?? null,
      wardId: (sa.wardId as number | undefined) ?? null,
      serviceRadiusKm: (sa.serviceRadiusKm as number | undefined) ?? 20,
      baseCallOutFee: (sa.baseCallOutFee as number | undefined) ?? null,
      verificationStatus: 'approved',
      verifiedAt: now,
      // Approval never puts a vet online: they go online themselves (§8.3).
      isAvailable: current?.verificationStatus === 'approved' ? current.isAvailable : false,
    })
    .where(eq(vets.userId, app.vetUserId));
  if (typeof p.fullName === 'string') {
    await tx.update(users).set({ name: p.fullName }).where(eq(users.id, app.vetUserId));
  }
}

/**
 * Suspend an approved vet (reason required, §8.3): offline in the same statement, open offers
 * withdrawn, audited. Also used by the licence-expiry job (admin null).
 */
export async function suspendVet(
  ctx: AppContext,
  vetUserId: string,
  input: { reasons: ApplicationReason[]; note?: string | undefined },
  adminUserId: string | null,
) {
  const now = ctx.clock();
  await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .update(vets)
      .set({ verificationStatus: 'suspended', isAvailable: false })
      .where(and(eq(vets.userId, vetUserId), eq(vets.verificationStatus, 'approved')))
      .returning({ userId: vets.userId });
    if (!row) throw new DomainError('invalid_transition', { event: 'suspend' });
    await tx
      .update(bookingOffers)
      .set({ response: 'timeout', respondedAt: now })
      .where(and(eq(bookingOffers.vetId, vetUserId), isNull(bookingOffers.response)));
  });
  await audit(
    ctx.db,
    {
      actorUserId: adminUserId,
      action: 'vet.suspended',
      entity: 'vet',
      entityId: vetUserId,
      meta: { reasons: input.reasons },
    },
    now,
  );
  await notifyVet(ctx, vetUserId, 'vet_suspended', {}, `${vetUserId}-${now.getTime()}`);
}

export async function reinstateVet(
  ctx: AppContext,
  vetUserId: string,
  adminUserId: string,
  note?: string,
) {
  const now = ctx.clock();
  const [row] = await ctx.db
    .update(vets)
    .set({ verificationStatus: 'approved' })
    .where(and(eq(vets.userId, vetUserId), eq(vets.verificationStatus, 'suspended')))
    .returning({ userId: vets.userId });
  if (!row) throw new DomainError('invalid_transition', { event: 'reinstate' });
  await audit(
    ctx.db,
    {
      actorUserId: adminUserId,
      action: 'vet.reinstated',
      entity: 'vet',
      entityId: vetUserId,
      meta: { note: note ?? null },
    },
    now,
  );
  await notifyVet(ctx, vetUserId, 'vet_reinstated', {}, `${vetUserId}-${now.getTime()}`);
}

/** A short-lived link to view one document; every view is logged (§17). */
export async function documentUrl(
  ctx: AppContext,
  documentId: number,
  adminUserId: string,
  log: FastifyBaseLogger,
) {
  const [doc] = await ctx.db.select().from(vetDocuments).where(eq(vetDocuments.id, documentId));
  if (!doc) throw new DomainError('not_found');
  const url = await ctx.storage.presignGet(doc.storageKey, DOCUMENT_URL_TTL_S);
  await audit(
    ctx.db,
    {
      actorUserId: adminUserId,
      action: 'vet_document.viewed',
      entity: 'vet_document',
      entityId: String(doc.id),
      meta: { kind: doc.kind, applicationId: doc.applicationId },
    },
    ctx.clock(),
  );
  log.info({ documentId, adminUserId }, 'vet document viewed');
  return {
    url,
    expiresAt: new Date(ctx.clock().getTime() + DOCUMENT_URL_TTL_S * 1000).toISOString(),
  };
}

/**
 * Assisted onboarding (§13): an admin starts an application for a vet who struggles with the UI.
 * The vet must still sign in with their own number (OTP) and submit it themselves, and the
 * assisting admin can never approve it.
 */
export async function startAssistedApplication(
  ctx: AppContext,
  admin: AuthContext,
  input: { phone: string; vetType: VetType; name?: string | undefined },
) {
  const phone = normalizePhone(input.phone);
  if (!phone) throw new DomainError('invalid_phone');
  await ctx.db
    .insert(users)
    .values({ phone, name: input.name ?? null, createdAt: ctx.clock() })
    .onConflictDoNothing({ target: users.phone, where: isNull(users.deletedAt) });
  const [user] = await ctx.db
    .select()
    .from(users)
    .where(and(eq(users.phone, phone), isNull(users.deletedAt)));
  if (!user) throw new DomainError('not_found');
  const [existing] = await ctx.db
    .select()
    .from(vetApplications)
    .where(eq(vetApplications.vetUserId, user.id))
    .limit(1);
  if (existing) throw new DomainError('application_locked', { reason: 'already_applied' });
  // No consent is recorded here: the vet gives it themselves after signing in with their own
  // number (OTP), and cannot submit without it.
  if (!user.roles.includes('vet')) {
    await ctx.db
      .update(users)
      .set({ roles: [...user.roles, 'vet'] })
      .where(eq(users.id, user.id));
  }
  await ctx.db
    .insert(vets)
    .values({ userId: user.id, type: input.vetType, verificationStatus: 'draft' })
    .onConflictDoNothing();
  const [app] = await ctx.db
    .insert(vetApplications)
    .values({
      vetUserId: user.id,
      version: 1,
      reference: `VL-TMP-${user.id}`,
      status: 'draft',
      createdVia: 'admin_assisted',
      createdBy: admin.userId,
      data: { professional_type: { vetType: input.vetType } },
    })
    .returning();
  if (!app) throw new Error('application insert failed');
  const reference = `VL-${ctx.clock().getUTCFullYear()}-${String(app.id).padStart(4, '0')}`;
  await ctx.db.update(vetApplications).set({ reference }).where(eq(vetApplications.id, app.id));
  await audit(
    ctx.db,
    {
      actorUserId: admin.userId,
      action: 'vet_application.assisted_start',
      entity: 'vet_application',
      entityId: String(app.id),
    },
    ctx.clock(),
  );
  return { applicationId: app.id, vetUserId: user.id, reference };
}

/** Grant admin (super admin only): opens a 72 h authenticator enrolment window (§8.0, M3). */
export async function grantAdmin(
  ctx: AppContext,
  actor: AuthContext,
  input: { phone: string; role: AdminRole },
) {
  const phone = normalizePhone(input.phone);
  if (!phone) throw new DomainError('invalid_phone');
  const [user] = await ctx.db
    .select()
    .from(users)
    .where(and(eq(users.phone, phone), isNull(users.deletedAt)));
  if (!user) throw new DomainError('not_found'); // they sign in once first, so the number is theirs
  if (user.id === actor.userId) throw new DomainError('forbidden');
  const now = ctx.clock();
  const enrol = new Date(now.getTime() + TOTP_ENROL_WINDOW_MS);
  await ctx.db
    .insert(adminProfiles)
    .values({
      userId: user.id,
      adminRole: input.role,
      grantedBy: actor.userId,
      grantedAt: now,
      totpEnrolExpiresAt: enrol,
    })
    .onConflictDoUpdate({
      target: adminProfiles.userId,
      set: {
        adminRole: input.role,
        grantedBy: actor.userId,
        grantedAt: now,
        revokedAt: null,
        totpEnabled: false,
        totpSecretEnc: null,
        recoveryCodesHash: null,
        totpEnrolExpiresAt: enrol,
      },
    });
  await audit(
    ctx.db,
    {
      actorUserId: actor.userId,
      action: 'admin.granted',
      entity: 'user',
      entityId: user.id,
      meta: { role: input.role },
    },
    now,
  );
  return { userId: user.id, role: input.role, enrolExpiresAt: enrol.toISOString() };
}

export async function revokeAdmin(ctx: AppContext, actor: AuthContext, userId: string) {
  if (userId === actor.userId) throw new DomainError('forbidden');
  const now = ctx.clock();
  const [row] = await ctx.db
    .update(adminProfiles)
    .set({ revokedAt: now })
    .where(and(eq(adminProfiles.userId, userId), isNull(adminProfiles.revokedAt)))
    .returning({ userId: adminProfiles.userId });
  if (!row) throw new DomainError('not_found');
  await audit(
    ctx.db,
    { actorUserId: actor.userId, action: 'admin.revoked', entity: 'user', entityId: userId },
    now,
  );
}

export async function listAdmins(ctx: AppContext) {
  return ctx.db
    .select({
      userId: adminProfiles.userId,
      role: adminProfiles.adminRole,
      name: users.name,
      phone: users.phone,
      totpEnabled: adminProfiles.totpEnabled,
      grantedAt: adminProfiles.grantedAt,
      revokedAt: adminProfiles.revokedAt,
    })
    .from(adminProfiles)
    .innerJoin(users, eq(users.id, adminProfiles.userId))
    .orderBy(asc(adminProfiles.grantedAt));
}

export { documentsOf };
