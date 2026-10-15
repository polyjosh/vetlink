import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { AppContext } from '../../context.js';
import { responses } from '../../schemas/common.js';
import { access, authOf } from '../auth/access.js';
import { chooseRoleBody, me, updateMeBody } from './schemas.js';
import { chooseRole, giveConsent, loadMe, updateMe } from './service.js';

const tags = ['me'];

export function userRoutes(app: FastifyInstance, ctx: AppContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/v1/me',
    {
      config: { access: access.user },
      schema: {
        tags,
        summary: 'Who am I: roles, onboarding state, vet status, admin permissions',
        description: 'Clients route from this (§8.0) and never infer roles locally.',
        response: responses({ 200: me }),
      },
    },
    async (req) => {
      const auth = authOf(req);
      return loadMe(ctx, auth.userId, auth.sessionId);
    },
  );

  r.patch(
    '/v1/me',
    {
      config: { access: access.user },
      schema: {
        tags,
        summary: 'Update name or language',
        body: updateMeBody,
        response: responses({ 200: me }),
      },
    },
    async (req) => {
      const auth = authOf(req);
      await updateMe(ctx, auth.userId, req.body);
      return loadMe(ctx, auth.userId, auth.sessionId);
    },
  );

  r.post(
    '/v1/me/consent',
    {
      config: { access: access.user },
      schema: {
        tags,
        summary: 'Accept the data protection terms',
        response: responses({ 200: me }),
      },
    },
    async (req) => {
      const auth = authOf(req);
      await giveConsent(ctx, auth.userId);
      return loadMe(ctx, auth.userId, auth.sessionId);
    },
  );

  r.post(
    '/v1/me/roles',
    {
      config: { access: access.user },
      schema: {
        tags,
        summary: 'Choose farmer or vet/paravet (admin is never self-service)',
        body: chooseRoleBody,
        response: responses({ 200: me }),
      },
    },
    async (req) => {
      const auth = authOf(req);
      await chooseRole(ctx, auth.userId, req.body);
      return loadMe(ctx, auth.userId, auth.sessionId);
    },
  );
}
