import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import {
  APPLICATION_STEPS,
  DOCUMENT_CONTENT_TYPES,
  DOCUMENT_MAX_BYTES,
  REQUIRED_DOCUMENTS,
  REVIEW_TARGET_HOURS,
  type ApplicationReason,
  type ApplicationStep,
  type VetDocumentKind,
  type VetService,
  type VetType,
} from '@vetlink/shared';
import type { AppContext } from '../../context.js';
import type { Tx } from '../../db/client.js';
import { users, vetApplications, vetDocuments, vets } from '../../db/schema/index.js';
import { fieldContext } from '../../lib/crypto.js';
import { DomainError } from '../../lib/errors.js';
import { getConfig } from '../config/service.js';
import { practiceProblems, type PracticeState } from '../vets/practice.js';
import { REQUIRED_FIELDS, STEP_PARTIAL, stepIndex, type StoredData } from './steps.js';

/** Step 5's prices and practice, read from the wizard answers. */
export function practiceStateOf(data: StoredData): PracticeState {
  const sa = data.service_area ?? {};
  return {
    services: (data.practice?.services as VetService[] | undefined) ?? [],
    consultationFee: sa.consultationFee as number | undefined,
    serviceFees: sa.serviceFees as Partial<Record<VetService, number>> | undefined,
    offersCallOuts: sa.offersCallOuts as boolean | undefined,
    hasPremises: sa.hasPremises as boolean | undefined,
    premisesWardId: sa.premisesWardId as number | null | undefined,
    baseCallOutFee: sa.baseCallOutFee as number | undefined,
  };
}

export type ApplicationRow = typeof vetApplications.$inferSelect;
export type DocumentRow = typeof vetDocuments.$inferSelect;

const UPLOAD_URL_TTL_S = 15 * 60;

const idContext = (applicationId: number) =>
  fieldContext('vet_applications.national_id', String(applicationId));

/** The vet's latest application version, creating version 1 on first use. */
export async function currentApplication(
  ctx: AppContext,
  vetUserId: string,
): Promise<ApplicationRow> {
  const [latest] = await ctx.db
    .select()
    .from(vetApplications)
    .where(eq(vetApplications.vetUserId, vetUserId))
    .orderBy(desc(vetApplications.version))
    .limit(1);
  if (latest) return latest;
  const [vet] = await ctx.db.select().from(vets).where(eq(vets.userId, vetUserId));
  if (!vet) throw new DomainError('not_found'); // choose the vet role first (POST /v1/me/roles)
  return createVersion(ctx, vetUserId, 1, { professional_type: { vetType: vet.type } }, {});
}

async function createVersion(
  ctx: AppContext,
  vetUserId: string,
  version: number,
  data: StoredData,
  extra: Partial<typeof vetApplications.$inferInsert>,
): Promise<ApplicationRow> {
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(vetApplications)
      .values({
        vetUserId,
        version,
        // Unique placeholder until we know the id.
        reference: `VL-TMP-${randomUUID()}`,
        status: 'draft',
        data,
        currentStep: 1,
        ...extra,
      })
      .onConflictDoNothing({ target: [vetApplications.vetUserId, vetApplications.version] })
      .returning();
    if (!row) {
      // A concurrent request created it.
      const [existing] = await tx
        .select()
        .from(vetApplications)
        .where(and(eq(vetApplications.vetUserId, vetUserId), eq(vetApplications.version, version)));
      if (!existing) throw new Error('application insert conflicted but none found');
      return existing;
    }
    const reference = `VL-${ctx.clock().getUTCFullYear()}-${String(row.id).padStart(4, '0')}`;
    const [named] = await tx
      .update(vetApplications)
      .set({ reference })
      .where(eq(vetApplications.id, row.id))
      .returning();
    return named ?? row;
  });
}

export function vetTypeOf(app: ApplicationRow): VetType {
  const t = (app.data as StoredData).professional_type?.vetType;
  return t === 'paravet' ? 'paravet' : 'vet';
}

export async function documentsOf(ctx: Pick<AppContext, 'db'>, applicationId: number) {
  return ctx.db
    .select()
    .from(vetDocuments)
    .where(eq(vetDocuments.applicationId, applicationId))
    .orderBy(vetDocuments.id);
}

/** What still blocks submission: missing fields (`step.field`) and documents. */
export async function missingItems(
  ctx: AppContext,
  app: ApplicationRow,
  docs: DocumentRow[],
): Promise<{ fields: string[]; documents: VetDocumentKind[] }> {
  const data = app.data as StoredData;
  const type = vetTypeOf(app);
  const fields: string[] = [];
  for (const step of APPLICATION_STEPS) {
    for (const f of REQUIRED_FIELDS[step]) {
      // A paravet's licence expiry is not required; a vet's is.
      const v = data[step]?.[f];
      if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) {
        fields.push(`${step}.${f}`);
      }
    }
  }
  if (type === 'vet' && !data.credentials?.licenceExpiry) fields.push('credentials.licenceExpiry');
  const today = ctx.clock().toISOString().slice(0, 10);
  const expiry = data.credentials?.licenceExpiry;
  if (typeof expiry === 'string' && expiry < today) fields.push('credentials.licenceExpiry');

  const bands = await getConfig(ctx, 'vets.feeBands');
  const maxRadius = await getConfig(ctx, 'vets.maxServiceRadiusKm');
  const fee = data.service_area?.baseCallOutFee;
  if (typeof fee === 'number' && (fee < bands.min || fee > bands.max)) {
    fields.push('service_area.baseCallOutFee');
  }
  const radius = data.service_area?.serviceRadiusKm;
  if (typeof radius === 'number' && radius > maxRadius) fields.push('service_area.serviceRadiusKm');
  for (const f of await practiceProblems(ctx, practiceStateOf(data), { complete: true })) {
    fields.push(`service_area.${f}`);
  }

  const have = new Set(docs.filter((d) => d.status !== 'flagged').map((d) => d.kind));
  const documents = REQUIRED_DOCUMENTS[type].filter((k) => !have.has(k));
  return { fields: [...new Set(fields)], documents };
}

/** Which fields and documents the vet may change now. */
function editRule(app: ApplicationRow): { all: true } | { only: Set<string> } | null {
  if (app.status === 'draft') return { all: true };
  if (app.status === 'changes_requested') {
    return { only: new Set((app.flaggedFields as string[] | null) ?? []) };
  }
  return null; // submitted, under review, decided: read-only
}

/** Autosave one step. In `changes_requested`, only the flagged fields may change. */
export async function saveStep(
  ctx: AppContext,
  vetUserId: string,
  step: ApplicationStep,
  input: unknown,
  options: { asAdmin?: string } = {},
): Promise<ApplicationRow> {
  const app = await currentApplication(ctx, vetUserId);
  if (options.asAdmin && (app.createdBy !== options.asAdmin || app.status !== 'draft')) {
    throw new DomainError('application_locked'); // only the assisting admin, only in draft
  }
  const rule = editRule(app);
  if (!rule) throw new DomainError('application_locked');
  const parsed = STEP_PARTIAL[step].safeParse(input);
  if (!parsed.success) {
    throw new DomainError('invalid_request', {
      fields: parsed.error.issues.map((i) => [step, ...i.path].join('.')),
    });
  }
  const values = { ...(parsed.data as Record<string, unknown>) };
  const data = structuredClone(app.data as StoredData);
  const current = { ...(data[step] ?? {}) };

  if (step === 'personal' && typeof values.nationalId === 'string') {
    const id = values.nationalId;
    delete values.nationalId;
    if (ctx.crypto.lookupHash(id) !== current.nationalIdHash) {
      values.nationalIdEnc = ctx.crypto.encrypt(id, idContext(app.id));
      values.nationalIdHash = ctx.crypto.lookupHash(id);
      values.nationalIdLast3 = id.slice(-3);
    }
  }
  if (step === 'service_area' && typeof values.baseCallOutFee === 'number') {
    const bands = await getConfig(ctx, 'vets.feeBands');
    if (values.baseCallOutFee < bands.min || values.baseCallOutFee > bands.max) {
      throw new DomainError('invalid_request', {
        fields: ['service_area.baseCallOutFee'],
        min: bands.min,
        max: bands.max,
      });
    }
  }
  if (step === 'service_area') {
    // Prices within the admin bands (§24.3), checked as the vet types, not only at submit.
    const merged = { ...data, service_area: { ...current, ...values } } as StoredData;
    const bad = await practiceProblems(ctx, practiceStateOf(merged), { complete: false });
    if (bad.length) {
      throw new DomainError('invalid_request', { fields: bad.map((f) => `service_area.${f}`) });
    }
  }
  if (step === 'service_area' && typeof values.serviceRadiusKm === 'number') {
    if (values.serviceRadiusKm > (await getConfig(ctx, 'vets.maxServiceRadiusKm'))) {
      throw new DomainError('invalid_request', { fields: ['service_area.serviceRadiusKm'] });
    }
  }

  if ('only' in rule) {
    const changed = Object.keys(values).filter(
      (k) => JSON.stringify(values[k]) !== JSON.stringify(current[k]),
    );
    const flagName = (k: string) => (k.startsWith('nationalId') ? 'nationalId' : k);
    const locked = changed.filter((k) => !rule.only.has(`${step}.${flagName(k)}`));
    if (locked.length > 0) {
      throw new DomainError('application_locked', {
        fields: [...new Set(locked.map((k) => `${step}.${flagName(k)}`))],
      });
    }
  }

  data[step] = { ...current, ...values };
  const [saved] = await ctx.db
    .update(vetApplications)
    .set({
      data,
      currentStep: Math.max(
        app.currentStep,
        Math.min(stepIndex(step) + 1, APPLICATION_STEPS.length),
      ),
    })
    .where(and(eq(vetApplications.id, app.id), eq(vetApplications.status, app.status)))
    .returning();
  if (!saved) throw new DomainError('application_locked'); // status changed meanwhile
  return saved;
}

function canChangeDocument(app: ApplicationRow, kind: VetDocumentKind): boolean {
  const rule = editRule(app);
  if (!rule) return false;
  return 'all' in rule || rule.only.has(`doc.${kind}`);
}

/** A presigned URL to upload one document straight to private storage. */
export async function presignDocument(
  ctx: AppContext,
  vetUserId: string,
  input: { kind: VetDocumentKind; contentType: string; size: number },
): Promise<{
  uploadUrl: string;
  storageKey: string;
  headers: Record<string, string>;
  expiresAt: string;
}> {
  const app = await currentApplication(ctx, vetUserId);
  if (!canChangeDocument(app, input.kind)) throw new DomainError('application_locked');
  if (!(DOCUMENT_CONTENT_TYPES as readonly string[]).includes(input.contentType)) {
    throw new DomainError('upload_invalid', { reason: 'type' });
  }
  if (input.size <= 0 || input.size > DOCUMENT_MAX_BYTES) {
    throw new DomainError('upload_invalid', { reason: 'size', maxBytes: DOCUMENT_MAX_BYTES });
  }
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' }[
    input.contentType as (typeof DOCUMENT_CONTENT_TYPES)[number]
  ];
  const storageKey = `vet-documents/${vetUserId}/${app.id}/${input.kind}-${randomUUID()}.${ext}`;
  const { url, headers } = await ctx.storage.presignPut(
    storageKey,
    input.contentType,
    UPLOAD_URL_TTL_S,
  );
  return {
    uploadUrl: url,
    storageKey,
    headers,
    expiresAt: new Date(ctx.clock().getTime() + UPLOAD_URL_TTL_S * 1000).toISOString(),
  };
}

/**
 * After the upload: check the object really is there, the right type and size, then record it
 * (replacing an earlier document of the same kind). Safe to retry.
 */
export async function confirmDocument(
  ctx: AppContext,
  vetUserId: string,
  input: { kind: VetDocumentKind; storageKey: string },
  log: FastifyBaseLogger,
): Promise<DocumentRow> {
  const app = await currentApplication(ctx, vetUserId);
  const prefix = `vet-documents/${vetUserId}/${app.id}/${input.kind}-`;
  if (!input.storageKey.startsWith(prefix))
    throw new DomainError('upload_invalid', { reason: 'key' });
  const docs = await documentsOf(ctx, app.id);
  const same = docs.find((d) => d.storageKey === input.storageKey);
  if (same) return same; // retry of a confirmed upload
  if (!canChangeDocument(app, input.kind)) throw new DomainError('application_locked');

  const head = await ctx.storage.head(input.storageKey);
  if (!head) throw new DomainError('upload_invalid', { reason: 'missing' });
  if (
    head.size > DOCUMENT_MAX_BYTES ||
    !(DOCUMENT_CONTENT_TYPES as readonly string[]).includes(head.contentType)
  ) {
    await ctx.storage.delete(input.storageKey).catch(() => {});
    throw new DomainError('upload_invalid', {
      reason: head.size > DOCUMENT_MAX_BYTES ? 'size' : 'type',
    });
  }
  const replaced = docs.filter((d) => d.kind === input.kind);
  const doc = await ctx.db.transaction(async (tx) => {
    for (const old of replaced) await tx.delete(vetDocuments).where(eq(vetDocuments.id, old.id));
    const [row] = await tx
      .insert(vetDocuments)
      .values({
        applicationId: app.id,
        vetUserId,
        kind: input.kind,
        storageKey: input.storageKey,
        status: 'uploaded',
        ...(input.kind === 'licence' && {
          expiresAt:
            ((app.data as StoredData).credentials?.licenceExpiry as string | undefined) ?? null,
        }),
      })
      .returning();
    if (!row) throw new Error('document insert failed');
    return row;
  });
  // Old files are no longer referenced; remove them (best effort).
  for (const old of replaced) {
    await ctx.storage
      .delete(old.storageKey)
      .catch((err: unknown) => log.warn({ err }, 'old document not deleted'));
  }
  return doc;
}

/** The vet's own status mirrors the first application; later versions leave an approved vet approved. */
async function syncVetStatus(
  tx: Tx,
  app: ApplicationRow,
  status: 'draft' | 'submitted' | 'under_review' | 'changes_requested' | 'rejected',
) {
  const [vet] = await tx
    .select({ status: vets.verificationStatus })
    .from(vets)
    .where(eq(vets.userId, app.vetUserId));
  if (!vet || vet.status === 'approved' || vet.status === 'suspended') return;
  await tx
    .update(vets)
    .set({ verificationStatus: status, isAvailable: false })
    .where(eq(vets.userId, app.vetUserId));
}

export async function submitApplication(
  ctx: AppContext,
  vetUserId: string,
): Promise<ApplicationRow> {
  const app = await currentApplication(ctx, vetUserId);
  if (app.status !== 'draft') throw new DomainError('application_locked');
  // The vet's own consent (given after signing in with their number) is required, including
  // for an application an admin filled in on their behalf (§13 assisted onboarding).
  const [me] = await ctx.db
    .select({ consentAt: users.consentAt })
    .from(users)
    .where(eq(users.id, vetUserId));
  if (!me?.consentAt) throw new DomainError('consent_required');
  const missing = await missingItems(ctx, app, await documentsOf(ctx, app.id));
  if (missing.fields.length || missing.documents.length) {
    throw new DomainError('application_incomplete', missing);
  }
  const now = ctx.clock();
  const submitted = await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .update(vetApplications)
      .set({ status: 'submitted', submittedAt: now })
      .where(and(eq(vetApplications.id, app.id), eq(vetApplications.status, 'draft')))
      .returning();
    if (!row) throw new DomainError('application_locked');
    await syncVetStatus(tx, row, 'submitted');
    return row;
  });
  await ctx.jobs.add(
    'notifications.send',
    {
      userId: vetUserId,
      kind: 'application_submitted',
      params: { ref: submitted.reference, hours: REVIEW_TARGET_HOURS },
    },
    { jobId: `app-submitted-${submitted.id}` },
  );
  return submitted;
}

/** Back to draft to edit, only until a reviewer has claimed it. */
export async function withdrawApplication(
  ctx: AppContext,
  vetUserId: string,
): Promise<ApplicationRow> {
  const app = await currentApplication(ctx, vetUserId);
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .update(vetApplications)
      .set({ status: 'draft', submittedAt: null })
      .where(and(eq(vetApplications.id, app.id), eq(vetApplications.status, 'submitted')))
      .returning();
    if (!row) throw new DomainError('application_locked'); // not submitted, or already claimed
    await syncVetStatus(tx, row, 'draft');
    return row;
  });
}

/** Fixed and sent back: returns to the queue (resubmissions are reviewed first). */
export async function resubmitApplication(
  ctx: AppContext,
  vetUserId: string,
): Promise<ApplicationRow> {
  const app = await currentApplication(ctx, vetUserId);
  if (app.status !== 'changes_requested') throw new DomainError('application_locked');
  const missing = await missingItems(ctx, app, await documentsOf(ctx, app.id));
  if (missing.fields.length || missing.documents.length) {
    throw new DomainError('application_incomplete', missing);
  }
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .update(vetApplications)
      .set({ status: 'submitted', claimedBy: null, claimedAt: null })
      .where(and(eq(vetApplications.id, app.id), eq(vetApplications.status, 'changes_requested')))
      .returning();
    if (!row) throw new DomainError('application_locked');
    await syncVetStatus(tx, row, 'submitted');
    return row;
  });
}

/**
 * An approved vet changing critical details (name, ID, KVB, licence, payout) starts a new
 * version; the change takes effect only when approved (§8.3). The vet stays approved meanwhile.
 */
export async function startNewVersion(ctx: AppContext, vetUserId: string): Promise<ApplicationRow> {
  const app = await currentApplication(ctx, vetUserId);
  if (app.status === 'draft' || app.status === 'changes_requested') return app; // already editing
  if (app.status !== 'approved') throw new DomainError('application_locked');
  const data = structuredClone(app.data as StoredData);
  const encId = data.personal?.nationalIdEnc;
  if (data.personal) delete data.personal.nationalIdEnc; // re-encrypted below, bound to the new row
  let next = await createVersion(ctx, vetUserId, app.version + 1, data, {});
  if (typeof encId === 'string' && data.personal) {
    // Encrypted values are bound to their row (GCM associated data), so a copy must be
    // re-encrypted for the new version, never copied as is.
    const plain = ctx.crypto.decrypt(encId, idContext(app.id));
    const withId = {
      ...data,
      personal: { ...data.personal, nationalIdEnc: ctx.crypto.encrypt(plain, idContext(next.id)) },
    };
    const [updated] = await ctx.db
      .update(vetApplications)
      .set({ data: withId })
      .where(eq(vetApplications.id, next.id))
      .returning();
    if (updated) next = updated;
  }
  // Carry the documents over; the vet replaces the ones that changed.
  const docs = await documentsOf(ctx, app.id);
  for (const d of docs) {
    await ctx.db
      .insert(vetDocuments)
      .values({
        applicationId: next.id,
        vetUserId,
        kind: d.kind,
        storageKey: d.storageKey,
        status: 'uploaded',
        expiresAt: d.expiresAt,
      })
      .onConflictDoNothing();
  }
  return next;
}

/** The vet's view of their application (never the encrypted ID, never internal notes). */
export async function applicationView(ctx: AppContext, app: ApplicationRow) {
  const docs = await documentsOf(ctx, app.id);
  const data = app.data as StoredData;
  // The encrypted ID and its hash never leave the server; the vet sees the last 3 digits.
  const hidden = new Set(['nationalIdEnc', 'nationalIdHash']);
  const steps = Object.fromEntries(
    APPLICATION_STEPS.map((s) => [
      s,
      Object.fromEntries(Object.entries(data[s] ?? {}).filter(([k]) => !hidden.has(k))),
    ]),
  ) as Record<ApplicationStep, Record<string, unknown>>;
  const missing = await missingItems(ctx, app, docs);
  const rule = editRule(app);
  return {
    id: app.id,
    reference: app.reference,
    version: app.version,
    status: app.status,
    createdVia: app.createdVia,
    currentStep: app.currentStep,
    steps,
    documents: docs.map((d) => ({
      id: d.id,
      kind: d.kind,
      status: d.status,
      flagReason: d.flagReason,
    })),
    requiredDocuments: [...REQUIRED_DOCUMENTS[vetTypeOf(app)]],
    missing,
    editable: (rule === null ? 'none' : 'all' in rule ? 'all' : 'flagged') as
      'none' | 'all' | 'flagged',
    flaggedFields: (app.flaggedFields as string[] | null) ?? [],
    decision:
      app.decidedAt && app.status !== 'submitted' && app.status !== 'under_review'
        ? {
            reasons: (app.decisionReasons ?? []) as ApplicationReason[],
            note: app.decisionNote,
            decidedAt: app.decidedAt.toISOString(),
          }
        : null,
    submittedAt: app.submittedAt ? app.submittedAt.toISOString() : null,
    reviewTargetHours: REVIEW_TARGET_HOURS,
  };
}
