import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import {
  PHOTO_CONTENT_TYPES,
  PHOTO_MAX_BYTES,
  type MeResponse,
  type PhotoContentType,
  type PhotoKind,
  type PhotoRejectReason,
} from '@vetlink/shared';
import type { AppContext } from '../../context.js';
import type { Tx } from '../../db/client.js';
import { animals, media, users, vetDocuments, vets } from '../../db/schema/index.js';
import { DomainError } from '../../lib/errors.js';
import { audit } from '../admin/audit.js';
import type { AuthContext } from '../auth/access.js';

type MediaRow = typeof media.$inferSelect;

const UPLOAD_URL_TTL_S = 15 * 60;
/** Photo links are short-lived (§17); clients refetch the view when they expire. */
export const PHOTO_URL_TTL_S = 60 * 60;

const EXT: Record<PhotoContentType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png' };
const keyPrefix = (userId: string, kind: PhotoKind) => `media/${userId}/${kind}-`;

export function photoUrl(ctx: Pick<AppContext, 'storage'>, storageKey: string): Promise<string> {
  return ctx.storage.presignGet(storageKey, PHOTO_URL_TTL_S);
}

/** Signed URLs for a set of media ids (missing or null ids map to nothing). */
export async function photoUrls(
  ctx: Pick<AppContext, 'db' | 'storage'>,
  ids: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => !!id))];
  if (wanted.length === 0) return new Map();
  const rows = await ctx.db
    .select({ id: media.id, storageKey: media.storageKey })
    .from(media)
    .where(inArray(media.id, wanted));
  const out = new Map<string, string>();
  for (const r of rows) out.set(r.id, await photoUrl(ctx, r.storageKey));
  return out;
}

/** A presigned PUT for a profile or animal photo (§24.1, §24.2). */
export async function presignPhoto(
  ctx: AppContext,
  auth: AuthContext,
  input: { kind: PhotoKind; contentType: PhotoContentType; size: number },
) {
  if (input.kind === 'animal_photo' && !auth.roles.includes('farmer')) {
    throw new DomainError('forbidden');
  }
  if (input.size <= 0 || input.size > PHOTO_MAX_BYTES) {
    throw new DomainError('photo_invalid', { reason: 'size', maxBytes: PHOTO_MAX_BYTES });
  }
  const storageKey = `${keyPrefix(auth.userId, input.kind)}${randomUUID()}.${EXT[input.contentType]}`;
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
 * Check an uploaded photo is really there, ours, the right kind, type and size. Returns the
 * existing row for a retry of the same upload, otherwise the object's metadata for a new row.
 */
async function checkUpload(
  ctx: AppContext,
  userId: string,
  kind: PhotoKind,
  storageKey: string,
): Promise<{ existing: MediaRow } | { contentType: string; size: number }> {
  if (!storageKey.startsWith(keyPrefix(userId, kind)) || storageKey.includes('..')) {
    throw new DomainError('photo_invalid', { reason: 'key' });
  }
  const [existing] = await ctx.db.select().from(media).where(eq(media.storageKey, storageKey));
  if (existing) return { existing };
  const head = await ctx.storage.head(storageKey);
  if (!head) throw new DomainError('photo_invalid', { reason: 'missing' });
  if (
    head.size > PHOTO_MAX_BYTES ||
    !(PHOTO_CONTENT_TYPES as readonly string[]).includes(head.contentType)
  ) {
    await ctx.storage.delete(storageKey).catch(() => {});
    throw new DomainError('photo_invalid', {
      reason: head.size > PHOTO_MAX_BYTES ? 'size' : 'type',
    });
  }
  return { contentType: head.contentType, size: head.size };
}

/** Delete media rows no longer referenced, then their objects (best effort, after commit). */
async function dropMedia(tx: Tx, rows: MediaRow[]): Promise<string[]> {
  if (rows.length === 0) return [];
  await tx.delete(media).where(
    inArray(
      media.id,
      rows.map((r) => r.id),
    ),
  );
  return rows.map((r) => r.storageKey);
}

async function deleteObjects(ctx: AppContext, keys: string[], log: FastifyBaseLogger) {
  for (const key of keys) {
    await ctx.storage
      .delete(key)
      .catch((err: unknown) => log.warn({ err }, 'old photo not deleted'));
  }
}

const mediaById = async (tx: Tx, id: string | null) =>
  id ? ((await tx.select().from(media).where(eq(media.id, id)))[0] ?? null) : null;

/**
 * Set my profile photo. A farmer's is live at once. A vet's waits for a verifier (§24.1),
 * replacing any earlier pending one; farmers keep seeing the approved photo until then.
 */
export async function setAvatar(
  ctx: AppContext,
  auth: AuthContext,
  storageKey: string,
  log: FastifyBaseLogger,
): Promise<void> {
  const upload = await checkUpload(ctx, auth.userId, 'avatar', storageKey);
  if ('existing' in upload) return; // retry of a confirmed upload
  const isVet = auth.roles.includes('vet');
  const stale = await ctx.db.transaction(async (tx) => {
    const [user] = await tx
      .select({ avatarMediaId: users.avatarMediaId })
      .from(users)
      .where(eq(users.id, auth.userId))
      .for('update');
    if (!user) throw new DomainError('not_found');
    const [row] = await tx
      .insert(media)
      .values({
        ownerUserId: auth.userId,
        storageKey,
        kind: 'avatar',
        contentType: upload.contentType,
        sizeBytes: upload.size,
        reviewStatus: isVet ? 'pending' : 'none',
        createdAt: ctx.clock(),
      })
      .returning();
    if (!row) throw new Error('media insert failed');
    if (isVet) {
      const [vet] = await tx
        .select({ pending: vets.pendingAvatarMediaId })
        .from(vets)
        .where(eq(vets.userId, auth.userId));
      if (!vet) throw new DomainError('not_found');
      await tx
        .update(vets)
        .set({ pendingAvatarMediaId: row.id })
        .where(eq(vets.userId, auth.userId));
      const old = await mediaById(tx, vet.pending);
      return dropMedia(tx, old ? [old] : []);
    }
    await tx.update(users).set({ avatarMediaId: row.id }).where(eq(users.id, auth.userId));
    const old = await mediaById(tx, user.avatarMediaId);
    return dropMedia(tx, old ? [old] : []);
  });
  await deleteObjects(ctx, stale, log);
}

/**
 * Remove my photo. A vet can withdraw a pending photo but never remove the verified one,
 * because farmers rely on it (§24.1).
 */
export async function removeAvatar(
  ctx: AppContext,
  auth: AuthContext,
  log: FastifyBaseLogger,
): Promise<void> {
  const stale = await ctx.db.transaction(async (tx) => {
    const [user] = await tx
      .select({ avatarMediaId: users.avatarMediaId })
      .from(users)
      .where(eq(users.id, auth.userId))
      .for('update');
    if (!user) throw new DomainError('not_found');
    if (auth.roles.includes('vet')) {
      const [vet] = await tx
        .select({ pending: vets.pendingAvatarMediaId })
        .from(vets)
        .where(eq(vets.userId, auth.userId));
      if (!vet?.pending) throw new DomainError('vet_photo_required');
      await tx.update(vets).set({ pendingAvatarMediaId: null }).where(eq(vets.userId, auth.userId));
      const old = await mediaById(tx, vet.pending);
      return dropMedia(tx, old ? [old] : []);
    }
    if (!user.avatarMediaId) return [];
    await tx.update(users).set({ avatarMediaId: null }).where(eq(users.id, auth.userId));
    const old = await mediaById(tx, user.avatarMediaId);
    return dropMedia(tx, old ? [old] : []);
  });
  await deleteObjects(ctx, stale, log);
}

/** Photo fields of `GET /v1/me`. */
export async function mePhoto(
  ctx: AppContext,
  userId: string,
  avatarMediaId: string | null,
): Promise<MeResponse['photo']> {
  const urls = await photoUrls(ctx, [avatarMediaId]);
  // The newest avatar upload tells whether a vet's change is waiting or was turned down.
  const [latest] = await ctx.db
    .select()
    .from(media)
    .where(and(eq(media.ownerUserId, userId), eq(media.kind, 'avatar')))
    .orderBy(desc(media.createdAt))
    .limit(1);
  let review: MeResponse['photo']['review'] = null;
  if (latest?.reviewStatus === 'pending') {
    review = { status: 'pending', url: await photoUrl(ctx, latest.storageKey) };
  } else if (latest?.reviewStatus === 'rejected') {
    review = { status: 'rejected', reason: latest.reviewReason ?? 'other' };
  }
  return { url: (avatarMediaId && urls.get(avatarMediaId)) ?? null, review };
}

/** Set an animal's photo (owner only; others get not_found). */
export async function setAnimalPhoto(
  ctx: AppContext,
  farmerId: string,
  animalId: string,
  storageKey: string,
  log: FastifyBaseLogger,
): Promise<void> {
  const upload = await checkUpload(ctx, farmerId, 'animal_photo', storageKey);
  const stale = await ctx.db.transaction(async (tx) => {
    const [animal] = await tx
      .select({ photoMediaId: animals.photoMediaId })
      .from(animals)
      .where(and(eq(animals.id, animalId), eq(animals.farmerId, farmerId)))
      .for('update');
    if (!animal) throw new DomainError('not_found');
    if ('existing' in upload) {
      if (upload.existing.animalId !== animalId) throw new DomainError('photo_invalid');
      return []; // retry of a confirmed upload
    }
    const [row] = await tx
      .insert(media)
      .values({
        ownerUserId: farmerId,
        storageKey,
        kind: 'animal_photo',
        animalId,
        contentType: upload.contentType,
        sizeBytes: upload.size,
        createdAt: ctx.clock(),
      })
      .returning();
    if (!row) throw new Error('media insert failed');
    await tx.update(animals).set({ photoMediaId: row.id }).where(eq(animals.id, animalId));
    const old = await mediaById(tx, animal.photoMediaId);
    return dropMedia(tx, old ? [old] : []);
  });
  await deleteObjects(ctx, stale, log);
}

export async function removeAnimalPhoto(
  ctx: AppContext,
  farmerId: string,
  animalId: string,
  log: FastifyBaseLogger,
): Promise<void> {
  const stale = await ctx.db.transaction(async (tx) => {
    const [animal] = await tx
      .select({ photoMediaId: animals.photoMediaId })
      .from(animals)
      .where(and(eq(animals.id, animalId), eq(animals.farmerId, farmerId)))
      .for('update');
    if (!animal) throw new DomainError('not_found');
    if (!animal.photoMediaId) return [];
    await tx.update(animals).set({ photoMediaId: null }).where(eq(animals.id, animalId));
    const old = await mediaById(tx, animal.photoMediaId);
    return dropMedia(tx, old ? [old] : []);
  });
  await deleteObjects(ctx, stale, log);
}

/**
 * On a vet's approval: the verified profile_photo document becomes the public photo, unless the
 * vet already has one (later photos go through the photo review). Copied, because documents
 * follow their own retention rules (§17). Returns the storage key to copy after the decision.
 */
export async function avatarFromApplication(
  tx: Tx,
  ctx: AppContext,
  vetUserId: string,
  applicationId: number,
): Promise<{ from: string; to: string } | null> {
  const [user] = await tx
    .select({ avatarMediaId: users.avatarMediaId })
    .from(users)
    .where(eq(users.id, vetUserId));
  if (!user || user.avatarMediaId) return null;
  const [doc] = await tx
    .select({ storageKey: vetDocuments.storageKey })
    .from(vetDocuments)
    .where(
      and(eq(vetDocuments.applicationId, applicationId), eq(vetDocuments.kind, 'profile_photo')),
    );
  if (!doc) return null;
  const ext = doc.storageKey.split('.').pop() === 'png' ? 'png' : 'jpg';
  const to = `${keyPrefix(vetUserId, 'avatar')}${randomUUID()}.${ext}`;
  // Copy first: if it fails, the approval fails too and nothing points at a missing object.
  await ctx.storage.copy(doc.storageKey, to);
  const head = await ctx.storage.head(to);
  const [row] = await tx
    .insert(media)
    .values({
      ownerUserId: vetUserId,
      storageKey: to,
      kind: 'avatar',
      contentType: head?.contentType ?? null,
      sizeBytes: head?.size ?? null,
      reviewStatus: 'approved',
      createdAt: ctx.clock(),
    })
    .returning();
  if (!row) throw new Error('media insert failed');
  await tx.update(users).set({ avatarMediaId: row.id }).where(eq(users.id, vetUserId));
  return { from: doc.storageKey, to };
}

/** Vet photos waiting for review, oldest first, with what the verifier compares against. */
export async function photoReviewQueue(ctx: AppContext) {
  const rows = await ctx.db
    .select({ media, name: users.name, type: vets.type, liveId: users.avatarMediaId })
    .from(vets)
    .innerJoin(media, eq(media.id, vets.pendingAvatarMediaId))
    .innerJoin(users, eq(users.id, vets.userId))
    .where(and(eq(media.reviewStatus, 'pending'), isNull(users.deletedAt)))
    .orderBy(asc(media.createdAt));
  const live = await photoUrls(
    ctx,
    rows.map((r) => r.liveId),
  );
  return Promise.all(
    rows.map(async (r) => {
      // The ID photo is opened through the logged document endpoint, never inlined here (§17).
      const [idDoc] = await ctx.db
        .select({ id: vetDocuments.id })
        .from(vetDocuments)
        .where(
          and(eq(vetDocuments.vetUserId, r.media.ownerUserId), eq(vetDocuments.kind, 'id_front')),
        )
        .orderBy(desc(vetDocuments.id))
        .limit(1);
      return {
        mediaId: r.media.id,
        vetUserId: r.media.ownerUserId,
        name: r.name,
        type: r.type,
        submittedAt: r.media.createdAt.toISOString(),
        pendingUrl: await photoUrl(ctx, r.media.storageKey),
        currentUrl: (r.liveId && live.get(r.liveId)) ?? null,
        idFrontDocumentId: idDoc?.id ?? null,
      };
    }),
  );
}

/** Approve or reject a vet's new photo (verifier). Audit-logged; the vet is told. */
export async function decidePhoto(
  ctx: AppContext,
  admin: AuthContext,
  mediaId: string,
  input: { decision: 'approve' } | { decision: 'reject'; reason: PhotoRejectReason },
  log: FastifyBaseLogger,
): Promise<void> {
  const now = ctx.clock();
  const { vetUserId, stale } = await ctx.db.transaction(async (tx) => {
    const [row] = await tx.select().from(media).where(eq(media.id, mediaId)).for('update');
    if (!row || row.kind !== 'avatar') throw new DomainError('not_found');
    if (row.reviewStatus !== 'pending') throw new DomainError('invalid_transition');
    const [vet] = await tx
      .select({ pending: vets.pendingAvatarMediaId })
      .from(vets)
      .where(eq(vets.userId, row.ownerUserId))
      .for('update');
    if (vet?.pending !== mediaId) throw new DomainError('invalid_transition');
    await tx
      .update(vets)
      .set({ pendingAvatarMediaId: null })
      .where(eq(vets.userId, row.ownerUserId));
    await tx
      .update(media)
      .set({
        reviewStatus: input.decision === 'approve' ? 'approved' : 'rejected',
        reviewedBy: admin.userId,
        reviewedAt: now,
        reviewReason: input.decision === 'reject' ? input.reason : null,
      })
      .where(eq(media.id, mediaId));
    if (input.decision === 'reject') {
      // Keep the row (the vet sees why), drop the picture itself (data minimisation, §17).
      return { vetUserId: row.ownerUserId, stale: [row.storageKey] };
    }
    const [user] = await tx
      .select({ avatarMediaId: users.avatarMediaId })
      .from(users)
      .where(eq(users.id, row.ownerUserId));
    await tx.update(users).set({ avatarMediaId: mediaId }).where(eq(users.id, row.ownerUserId));
    const old = await mediaById(tx, user?.avatarMediaId ?? null);
    return { vetUserId: row.ownerUserId, stale: await dropMedia(tx, old ? [old] : []) };
  });
  await deleteObjects(ctx, stale, log);
  await audit(
    ctx.db,
    {
      actorUserId: admin.userId,
      action: `vet_photo.${input.decision === 'approve' ? 'approved' : 'rejected'}`,
      entity: 'media',
      entityId: mediaId,
      meta: { vetUserId, ...(input.decision === 'reject' && { reason: input.reason }) },
    },
    now,
  );
  const kind = input.decision === 'approve' ? 'photo_approved' : 'photo_rejected';
  await ctx.jobs.add(
    'notifications.send',
    { userId: vetUserId, kind, params: {} },
    { jobId: `${kind}-${mediaId}` },
  );
}
