import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  DOCUMENT_CONTENT_TYPES,
  PHOTO_CONTENT_TYPES,
  PHOTO_KINDS,
  PHOTO_REJECT_REASONS,
  VET_DOCUMENT_KINDS,
  VET_TYPES,
} from '@vetlink/shared';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { DomainError } from '../../lib/errors.js';
import { named, noContent, responses } from '../../schemas/common.js';
import { presignDocument } from '../applications/service.js';
import { access, authOf } from '../auth/access.js';
import { animal, me } from '../users/schemas.js';
import { animalById, loadMe } from '../users/service.js';
import {
  decidePhoto,
  photoReviewQueue,
  presignPhoto,
  removeAnimalPhoto,
  removeAvatar,
  setAnimalPhoto,
  setAvatar,
} from './service.js';

const presignedUpload = named(
  z.object({
    uploadUrl: z.string(),
    storageKey: z.string(),
    headers: z.record(z.string(), z.string()),
    expiresAt: z.string(),
  }),
  'PresignedUpload',
);

const confirmBody = z.object({ storageKey: z.string().min(1).max(300) });

const photoReviewItem = named(
  z.object({
    mediaId: z.string(),
    vetUserId: z.string(),
    name: z.string().nullable(),
    type: z.enum(VET_TYPES),
    submittedAt: z.string(),
    pendingUrl: z.string(),
    currentUrl: z.string().nullable(),
    idFrontDocumentId: z
      .number()
      .int()
      .nullable()
      .describe('Open with GET /v1/admin/vet-documents/:id/url (logged)'),
  }),
  'PhotoReviewItem',
);

export function mediaRoutes(app: FastifyInstance, ctx: AppContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/v1/uploads/presign',
    {
      config: { access: access.user },
      schema: {
        tags: ['uploads'],
        summary: 'Get a URL to upload a file straight to private storage',
        description:
          'PUT the file to `uploadUrl` with `headers`, then confirm it: vet documents with POST /v1/vets/me/application/documents (vet role), avatars with PUT /v1/me/avatar, animal photos with PUT /v1/animals/:id/photo (farmer role). Photos must be re-encoded on the device (drops EXIF) and be at most 500 KB.',
        body: z.discriminatedUnion('purpose', [
          z.object({
            purpose: z.literal('vet_document'),
            documentKind: z.enum(VET_DOCUMENT_KINDS),
            contentType: z.enum(DOCUMENT_CONTENT_TYPES),
            size: z.number().int().positive(),
          }),
          z.object({
            purpose: z.literal('photo'),
            photoKind: z.enum(PHOTO_KINDS),
            contentType: z.enum(PHOTO_CONTENT_TYPES),
            size: z.number().int().positive(),
          }),
        ]),
        response: responses({ 200: presignedUpload }),
      },
    },
    async (req) => {
      const auth = authOf(req);
      const body = req.body;
      if (body.purpose === 'vet_document') {
        if (!auth.roles.includes('vet')) throw new DomainError('forbidden');
        return presignDocument(ctx, auth.userId, {
          kind: body.documentKind,
          contentType: body.contentType,
          size: body.size,
        });
      }
      return presignPhoto(ctx, auth, {
        kind: body.photoKind,
        contentType: body.contentType,
        size: body.size,
      });
    },
  );

  r.put(
    '/v1/me/avatar',
    {
      config: { access: access.user },
      schema: {
        tags: ['me'],
        summary: 'Set my profile photo (after uploading it)',
        description:
          "A farmer's photo is live at once. A vet's new photo waits for a verifier (`photo.review`); farmers keep seeing the approved one. Safe to retry.",
        body: confirmBody,
        response: responses({ 200: me }),
      },
    },
    async (req) => {
      const auth = authOf(req);
      await setAvatar(ctx, auth, req.body.storageKey, req.log);
      return loadMe(ctx, auth.userId, auth.sessionId);
    },
  );

  r.delete(
    '/v1/me/avatar',
    {
      config: { access: access.user },
      schema: {
        tags: ['me'],
        summary: 'Remove my profile photo (vets: withdraw a pending photo only)',
        response: responses({ 200: me }),
      },
    },
    async (req) => {
      const auth = authOf(req);
      await removeAvatar(ctx, auth, req.log);
      return loadMe(ctx, auth.userId, auth.sessionId);
    },
  );

  const animalParams = z.object({ id: z.uuid() });

  r.put(
    '/v1/animals/:id/photo',
    {
      config: { access: access.role('farmer') },
      schema: {
        tags: ['animals'],
        summary: "Set an animal's photo (after uploading it). Safe to retry.",
        params: animalParams,
        body: confirmBody,
        response: responses({ 200: animal }),
      },
    },
    async (req) => {
      const farmerId = authOf(req).userId;
      await setAnimalPhoto(ctx, farmerId, req.params.id, req.body.storageKey, req.log);
      return animalById(ctx, farmerId, req.params.id);
    },
  );

  r.delete(
    '/v1/animals/:id/photo',
    {
      config: { access: access.role('farmer') },
      schema: {
        tags: ['animals'],
        summary: "Remove an animal's photo (the species picture is shown instead)",
        params: animalParams,
        response: responses({ 200: animal }),
      },
    },
    async (req) => {
      const farmerId = authOf(req).userId;
      await removeAnimalPhoto(ctx, farmerId, req.params.id, req.log);
      return animalById(ctx, farmerId, req.params.id);
    },
  );

  r.get(
    '/v1/admin/vet-photos',
    {
      config: { access: access.admin('verifier') },
      schema: {
        tags: ['admin'],
        summary: 'Vet profile photos waiting for review, oldest first',
        response: responses({ 200: z.array(photoReviewItem) }),
      },
    },
    async () => photoReviewQueue(ctx),
  );

  r.post(
    '/v1/admin/vet-photos/:mediaId/decision',
    {
      config: { access: access.admin('verifier') },
      schema: {
        tags: ['admin'],
        summary: "Approve or reject a vet's new profile photo (audit-logged; the vet is told)",
        params: z.object({ mediaId: z.uuid() }),
        body: z.discriminatedUnion('decision', [
          z.object({ decision: z.literal('approve') }),
          z.object({ decision: z.literal('reject'), reason: z.enum(PHOTO_REJECT_REASONS) }),
        ]),
        response: responses({ 204: noContent }),
      },
    },
    async (req, reply) => {
      await decidePhoto(ctx, authOf(req), req.params.mediaId, req.body, req.log);
      return reply.code(204).send(null);
    },
  );
}
