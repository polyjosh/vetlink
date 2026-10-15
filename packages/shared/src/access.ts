import {
  ADMIN_ROLES,
  type AdminRole,
  type SessionRole,
  type VerificationStatus,
} from './domain.js';

/**
 * Admin permissions are the admin roles (§8.0). Every admin endpoint declares the one it needs;
 * `super_admin` holds all of them.
 */
export type AdminPermission = AdminRole;

export function adminHasPermission(role: AdminRole, permission: AdminPermission): boolean {
  return role === 'super_admin' || role === permission;
}

export function adminPermissions(role: AdminRole): AdminPermission[] {
  return role === 'super_admin' ? [...ADMIN_ROLES] : [role];
}

/** `GET /v1/me`. Clients route from this; they never infer roles locally (§8.0). */
export interface MeResponse {
  id: string;
  phone: string;
  name: string | null;
  language: string;
  roles: SessionRole[];
  onboarding: { consented: boolean; roleChosen: boolean };
  vet: { verificationStatus: VerificationStatus } | null;
  admin: {
    role: AdminRole;
    permissions: AdminPermission[];
    totpEnabled: boolean;
    twoFactorVerified: boolean;
  } | null;
}

/** Destinations of the client route resolver, one per row of the §8.0 table. */
export const HOME_ROUTES = [
  'onboarding',
  'farmer_home',
  'vet_application',
  'vet_under_review',
  'vet_changes_requested',
  'vet_blocked',
  'vet_home',
  'admin_2fa',
  'admin_2fa_setup',
  'admin_home',
] as const;
export type HomeRoute = (typeof HOME_ROUTES)[number];

const VET_ROUTES: Record<VerificationStatus, HomeRoute> = {
  draft: 'vet_application',
  submitted: 'vet_under_review',
  under_review: 'vet_under_review',
  changes_requested: 'vet_changes_requested',
  rejected: 'vet_blocked',
  suspended: 'vet_blocked',
  approved: 'vet_home',
};

// Default role when the user has several and no (valid) last-used role.
const ROLE_PRIORITY: readonly SessionRole[] = ['farmer', 'vet', 'admin'];

export interface ResolvedRoute {
  route: HomeRoute;
  /** The role whose home was chosen; null during onboarding. */
  role: SessionRole | null;
  /** Roles the role switcher offers. */
  roles: SessionRole[];
}

/**
 * The §8.0 route resolver, shared by mobile and web. UX only: every API endpoint enforces role
 * and permission on the server regardless of where the client navigates.
 */
export function resolveHomeRoute(
  me: Pick<MeResponse, 'roles' | 'onboarding' | 'vet' | 'admin'>,
  lastRole?: SessionRole | null,
): ResolvedRoute {
  const roles = me.roles;
  const isAdmin = roles.includes('admin');
  // Admins are never sent through self-signup onboarding.
  if (!isAdmin && (!me.onboarding.consented || !me.onboarding.roleChosen)) {
    return { route: 'onboarding', role: null, roles };
  }
  const role =
    lastRole && roles.includes(lastRole)
      ? lastRole
      : (ROLE_PRIORITY.find((r) => roles.includes(r)) ?? null);

  switch (role) {
    case 'farmer':
      return { route: 'farmer_home', role, roles };
    case 'vet':
      return {
        route: me.vet ? VET_ROUTES[me.vet.verificationStatus] : 'vet_application',
        role,
        roles,
      };
    case 'admin': {
      let route: HomeRoute = 'admin_home';
      if (!me.admin?.totpEnabled) route = 'admin_2fa_setup';
      else if (!me.admin.twoFactorVerified) route = 'admin_2fa';
      return { route, role, roles };
    }
    default:
      return { route: 'onboarding', role: null, roles };
  }
}
