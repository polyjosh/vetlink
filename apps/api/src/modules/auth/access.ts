import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import {
  adminHasPermission,
  type AdminPermission,
  type AdminRole,
  type SessionRole,
  type UserRole,
} from '@vetlink/shared';
import type { AppContext } from '../../context.js';
import type { Db } from '../../db/client.js';
import { adminProfiles, authSessions, users } from '../../db/schema/index.js';
import { DomainError, type ErrorCode } from '../../lib/errors.js';
import type { AccessClaims } from './tokens.js';

/** Admin 2FA lasts this long on a session ("short admin sessions", §17). */
export const ADMIN_2FA_TTL_MS = 8 * 60 * 60 * 1000;
/** Sensitive admin actions need a TOTP code entered this recently (§8.0). */
export const STEP_UP_TTL_MS = 5 * 60 * 1000;

/**
 * Every route declares who may call it (§10). A route without a declaration, or an
 * `/v1/admin/*` route without an admin declaration, stops the app from starting.
 */
export type RouteAccess =
  | { kind: 'public' }
  | { kind: 'user' } // any signed-in user, including one still onboarding
  | { kind: 'role'; role: UserRole }
  | { kind: 'admin'; permission: AdminPermission; stepUp: boolean };

export const access = {
  public: { kind: 'public' } as RouteAccess,
  user: { kind: 'user' } as RouteAccess,
  role: (role: UserRole): RouteAccess => ({ kind: 'role', role }),
  admin: (permission: AdminPermission, opts: { stepUp?: boolean } = {}): RouteAccess => ({
    kind: 'admin',
    permission,
    stepUp: opts.stepUp ?? false,
  }),
};

export interface AuthContext {
  userId: string;
  sessionId: string;
  deviceId: string | null;
  /** From the database on every request, never from the token. */
  roles: UserRole[];
  admin: {
    role: AdminRole;
    totpEnabled: boolean;
    mfaVerifiedAt: Date | null;
    stepUpAt: Date | null;
  } | null;
}

declare module 'fastify' {
  interface FastifyContextConfig {
    access?: RouteAccess;
  }
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

/** The signed-in caller. Only valid on routes whose access is not `public`. */
export function authOf(request: FastifyRequest): AuthContext {
  if (!request.auth) throw new DomainError('unauthenticated');
  return request.auth;
}

export function sessionRoles(roles: readonly UserRole[], isAdmin: boolean): SessionRole[] {
  return isAdmin ? [...roles, 'admin'] : [...roles];
}

export function isRecent(at: Date | null, ttlMs: number, now: Date): boolean {
  return at !== null && now.getTime() - at.getTime() < ttlMs;
}

/** Load the live session for verified token claims. Null if revoked, deleted, or mismatched. */
export async function loadAuthContext(db: Db, claims: AccessClaims): Promise<AuthContext | null> {
  const [row] = await db
    .select({
      roles: users.roles,
      userDeletedAt: users.deletedAt,
      sessionRevokedAt: authSessions.revokedAt,
      deviceId: authSessions.deviceId,
      mfaVerifiedAt: authSessions.mfaVerifiedAt,
      stepUpAt: authSessions.stepUpAt,
      adminRole: adminProfiles.adminRole,
      adminRevokedAt: adminProfiles.revokedAt,
      totpEnabled: adminProfiles.totpEnabled,
    })
    .from(authSessions)
    .innerJoin(users, eq(users.id, authSessions.userId))
    .leftJoin(adminProfiles, eq(adminProfiles.userId, users.id))
    .where(and(eq(authSessions.id, claims.sessionId), eq(authSessions.userId, claims.userId)))
    .limit(1);
  if (!row || row.sessionRevokedAt || row.userDeletedAt) return null;
  const activeAdmin = row.adminRole !== null && row.adminRevokedAt === null;
  return {
    userId: claims.userId,
    sessionId: claims.sessionId,
    deviceId: row.deviceId,
    roles: row.roles,
    admin: activeAdmin
      ? {
          role: row.adminRole as AdminRole,
          totpEnabled: row.totpEnabled ?? false,
          mfaVerifiedAt: row.mfaVerifiedAt,
          stepUpAt: row.stepUpAt,
        }
      : null,
  };
}

/** Why a signed-in caller is refused, or null if allowed. */
export function denialFor(rule: RouteAccess, auth: AuthContext, now: Date): ErrorCode | null {
  switch (rule.kind) {
    case 'public':
    case 'user':
      return null;
    case 'role':
      return auth.roles.includes(rule.role) ? null : 'forbidden';
    case 'admin': {
      // Non-admins and admins without the permission get "not found": admin routes ship in a
      // public app, so do not confirm they exist (§8.0, §17).
      if (!auth.admin) return 'not_found';
      if (!auth.admin.totpEnabled) return 'two_factor_setup_required';
      if (!isRecent(auth.admin.mfaVerifiedAt, ADMIN_2FA_TTL_MS, now)) return 'two_factor_required';
      if (!adminHasPermission(auth.admin.role, rule.permission)) return 'not_found';
      if (rule.stepUp && !isRecent(auth.admin.stepUpAt, STEP_UP_TTL_MS, now)) {
        return 'step_up_required';
      }
      return null;
    }
  }
}

function guard(ctx: AppContext, rule: RouteAccess, url: string): preHandlerHookHandler {
  return async (request) => {
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    const now = ctx.clock();
    const claims = token ? await ctx.tokens.verify(token, now) : null;
    const auth = claims ? await loadAuthContext(ctx.db, claims) : null;
    if (!auth) {
      if (rule.kind === 'admin') request.log.warn({ route: url }, 'admin route: unauthenticated');
      throw new DomainError('unauthenticated');
    }
    request.auth = auth;
    const denial = denialFor(rule, auth, now);
    if (denial) {
      request.log.warn(
        { route: url, userId: auth.userId, sessionId: auth.sessionId, denial },
        'access denied',
      );
      throw new DomainError(denial);
    }
  };
}

/**
 * Install before any route is registered. `ctx` is null only in apps without the database
 * (health-check tests); there, only public routes are allowed.
 */
export function registerAccessControl(app: FastifyInstance, ctx: AppContext | null): void {
  app.decorateRequest('auth', null);
  app.addHook('onRoute', (route) => {
    const rule = route.config?.access;
    const name = `${String(route.method)} ${route.url}`;
    if (!rule) throw new Error(`Route ${name} does not declare config.access`);
    if (route.url.startsWith('/v1/admin') && rule.kind !== 'admin') {
      throw new Error(`Admin route ${name} must declare admin access with a permission`);
    }
    if (rule.kind === 'public') return;
    if (!ctx) throw new Error(`Route ${name} needs authentication but the app has no context`);
    const existing = route.preHandler;
    const handlers = existing === undefined ? [] : Array.isArray(existing) ? existing : [existing];
    route.preHandler = [guard(ctx, rule, route.url), ...handlers];
  });
}
