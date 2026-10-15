import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { adminPermissions, type MeResponse } from '@vetlink/shared';
import type { AppContext } from '../../context.js';
import { users, vets } from '../../db/schema/index.js';
import { DomainError } from '../../lib/errors.js';
import { ADMIN_2FA_TTL_MS, access, authOf, isRecent, sessionRoles } from '../auth/access.js';

export function userRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** Profile, roles, onboarding state, vet status, admin permissions: what clients route on. */
  app.get('/v1/me', { config: { access: access.user } }, async (req): Promise<MeResponse> => {
    const auth = authOf(req);
    const [row] = await ctx.db
      .select({
        phone: users.phone,
        name: users.name,
        language: users.language,
        consentAt: users.consentAt,
        verificationStatus: vets.verificationStatus,
      })
      .from(users)
      .leftJoin(vets, eq(vets.userId, users.id))
      .where(eq(users.id, auth.userId))
      .limit(1);
    if (!row?.phone) throw new DomainError('not_found');
    return {
      id: auth.userId,
      phone: row.phone,
      name: row.name,
      language: row.language,
      roles: sessionRoles(auth.roles, auth.admin !== null),
      onboarding: { consented: row.consentAt !== null, roleChosen: auth.roles.length > 0 },
      vet:
        auth.roles.includes('vet') && row.verificationStatus
          ? { verificationStatus: row.verificationStatus }
          : null,
      admin: auth.admin
        ? {
            role: auth.admin.role,
            permissions: adminPermissions(auth.admin.role),
            totpEnabled: auth.admin.totpEnabled,
            twoFactorVerified:
              auth.admin.totpEnabled &&
              isRecent(auth.admin.mfaVerifiedAt, ADMIN_2FA_TTL_MS, ctx.clock()),
          }
        : null,
    };
  });
}
