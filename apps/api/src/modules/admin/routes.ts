import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { parseInput } from '../../lib/errors.js';
import { access, authOf } from '../auth/access.js';
import { resetTwoFactor } from '../auth/two-factor.js';

const userParams = z.object({ userId: z.uuid() });

export function adminRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** Reset another admin's 2FA. Super admin only, with a fresh step-up; audit-logged. */
  app.post(
    '/v1/admin/users/:userId/2fa/reset',
    { config: { access: access.admin('super_admin', { stepUp: true }) } },
    async (req) => {
      const { userId } = parseInput(userParams, req.params);
      const { enrolExpiresAt } = await resetTwoFactor(ctx, authOf(req), userId, req.log);
      return { enrolExpiresAt: enrolExpiresAt.toISOString() };
    },
  );
}
