import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { interpolate, messages } from '@vetlink/i18n';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { notifications, users } from '../../db/schema/index.js';
import { DomainError } from '../../lib/errors.js';
import { intId, named, noContent, responses } from '../../schemas/common.js';
import { access, authOf } from '../auth/access.js';
import { markRead, NOTIFICATION_KINDS, type NotificationKind } from './service.js';

const notificationView = named(
  z.object({
    id: z.number().int(),
    kind: z.enum(Object.keys(NOTIFICATION_KINDS) as [NotificationKind, ...NotificationKind[]]),
    title: z.string(),
    body: z.string(),
    data: z.record(z.string(), z.union([z.string(), z.number()])),
    createdAt: z.string(),
    readAt: z.string().nullable(),
  }),
  'Notification',
);

export function notificationRoutes(app: FastifyInstance, ctx: AppContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ['notifications'];

  r.get(
    '/v1/notifications',
    {
      config: { access: access.user },
      schema: {
        tags,
        summary: 'My notifications, newest first (in my language)',
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }),
        response: responses({ 200: z.array(notificationView) }),
      },
    },
    async (req) => {
      const userId = authOf(req).userId;
      const [user] = await ctx.db
        .select({ language: users.language })
        .from(users)
        .where(eq(users.id, userId));
      const lang = user?.language ?? 'sw';
      const rows = await ctx.db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, userId))
        .orderBy(desc(notifications.id))
        .limit(req.query.limit);
      return rows
        .filter((n) => n.kind in NOTIFICATION_KINDS)
        .map((n) => {
          const kind = n.kind as NotificationKind;
          const p = n.payload as {
            params: Record<string, string | number>;
            localized?: { animal?: string; problem?: string };
            data: Record<string, string | number>;
          };
          const t = messages[lang].notify[kind];
          const species = messages[lang].ussd.species as Record<string, string>;
          const problems = messages[lang].ussd.problems as Record<string, string>;
          const params = {
            ...p.params,
            ...(p.localized?.animal && { animal: species[p.localized.animal] ?? '' }),
            ...(p.localized?.problem && { problem: problems[p.localized.problem] ?? '' }),
          };
          return {
            id: n.id,
            kind,
            title: interpolate(t.title, params),
            body: interpolate(t.body, params),
            data: p.data,
            createdAt: n.createdAt.toISOString(),
            readAt: n.readAt ? n.readAt.toISOString() : null,
          };
        });
    },
  );

  r.post(
    '/v1/notifications/:id/read',
    {
      config: { access: access.user },
      schema: {
        tags,
        summary:
          'Confirm a notification (the app calls this on receipt; it stops the SMS fallback)',
        params: z.object({ id: intId }),
        response: responses({ 204: noContent }),
      },
    },
    async (req, reply) => {
      if (!(await markRead(ctx, authOf(req).userId, req.params.id))) {
        throw new DomainError('not_found');
      }
      return reply.code(204).send(null);
    },
  );
}
