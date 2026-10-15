import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_ROLES,
  adminHasPermission,
  adminPermissions,
  normalizePhone,
  resolveHomeRoute,
  type HomeRoute,
  type MeResponse,
  type SessionRole,
  type VerificationStatus,
} from '@vetlink/shared';
import { buildApp } from '../src/app.js';
import {
  ADMIN_2FA_TTL_MS,
  STEP_UP_TTL_MS,
  access,
  denialFor,
  type AuthContext,
} from '../src/modules/auth/access.js';

describe('route access declarations', () => {
  const build = (register?: (app: FastifyInstance) => void) =>
    buildApp({ logLevel: 'silent', deps: [], ...(register && { extraRoutes: register }) });

  it('refuses to start when a route does not declare access', () => {
    expect(() => build((app) => app.get('/v1/oops', async () => ({})))).toThrow(
      /does not declare config.access/,
    );
  });

  it('refuses an /v1/admin route without an admin permission', () => {
    expect(() =>
      build((app) =>
        app.get('/v1/admin/things', { config: { access: access.user } }, async () => ({})),
      ),
    ).toThrow(/must declare admin access/);
    expect(() =>
      build((app) =>
        app.get('/v1/admin/things', { config: { access: access.public } }, async () => ({})),
      ),
    ).toThrow(/must declare admin access/);
  });

  it('refuses an authenticated route when the app has no auth context', () => {
    expect(() =>
      build((app) => app.get('/v1/x', { config: { access: access.user } }, async () => ({}))),
    ).toThrow(/no context/);
  });

  it('returns the standard error shape for unknown routes', async () => {
    const app = build();
    const res = await app.inject({ method: 'GET', url: '/v1/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ code: 'not_found', message_key: 'errors.not_found', details: {} });
    await app.close();
  });
});

describe('denialFor (role and permission matrix)', () => {
  const now = new Date('2026-10-15T08:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const user = (over: Partial<AuthContext> = {}): AuthContext => ({
    userId: 'u',
    sessionId: 's',
    deviceId: null,
    roles: [],
    admin: null,
    ...over,
  });
  const admin = (
    role: (typeof ADMIN_ROLES)[number],
    over: Partial<NonNullable<AuthContext['admin']>> = {},
  ) =>
    user({ admin: { role, totpEnabled: true, mfaVerifiedAt: ago(1000), stepUpAt: null, ...over } });

  it('role routes need the role in the database-loaded roles', () => {
    expect(denialFor(access.role('vet'), user({ roles: ['farmer'] }), now)).toBe('forbidden');
    expect(denialFor(access.role('vet'), user({ roles: ['farmer', 'vet'] }), now)).toBeNull();
    expect(denialFor(access.user, user(), now)).toBeNull();
  });

  it('admin routes look like "not found" to non-admins', () => {
    expect(denialFor(access.admin('analyst'), user({ roles: ['farmer', 'vet'] }), now)).toBe(
      'not_found',
    );
  });

  it('admin routes need 2FA set up and verified within the session window', () => {
    expect(denialFor(access.admin('support'), admin('support', { totpEnabled: false }), now)).toBe(
      'two_factor_setup_required',
    );
    expect(denialFor(access.admin('support'), admin('support', { mfaVerifiedAt: null }), now)).toBe(
      'two_factor_required',
    );
    expect(
      denialFor(
        access.admin('support'),
        admin('support', { mfaVerifiedAt: ago(ADMIN_2FA_TTL_MS) }),
        now,
      ),
    ).toBe('two_factor_required');
  });

  it('each permission unlocks only its own endpoints; super_admin unlocks all', () => {
    for (const held of ADMIN_ROLES) {
      for (const needed of ADMIN_ROLES) {
        const allowed = held === 'super_admin' || held === needed;
        expect(denialFor(access.admin(needed), admin(held), now)).toBe(
          allowed ? null : 'not_found',
        );
        expect(adminHasPermission(held, needed)).toBe(allowed);
      }
    }
    expect(adminPermissions('super_admin')).toEqual([...ADMIN_ROLES]);
    expect(adminPermissions('finance')).toEqual(['finance']);
  });

  it('sensitive routes need a step-up within the last 5 minutes', () => {
    const rule = access.admin('finance', { stepUp: true });
    expect(denialFor(rule, admin('finance'), now)).toBe('step_up_required');
    expect(denialFor(rule, admin('finance', { stepUpAt: ago(60_000) }), now)).toBeNull();
    expect(denialFor(rule, admin('finance', { stepUpAt: ago(STEP_UP_TTL_MS) }), now)).toBe(
      'step_up_required',
    );
  });
});

describe('resolveHomeRoute (§8.0 table)', () => {
  const me = (
    roles: SessionRole[],
    over: Partial<Pick<MeResponse, 'onboarding' | 'vet' | 'admin'>> = {},
  ): Pick<MeResponse, 'roles' | 'onboarding' | 'vet' | 'admin'> => ({
    roles,
    onboarding: { consented: true, roleChosen: roles.some((r) => r !== 'admin') },
    vet: null,
    admin: null,
    ...over,
  });
  const vet = (status: VerificationStatus) => me(['vet'], { vet: { verificationStatus: status } });
  const adminMe = (totpEnabled: boolean, twoFactorVerified: boolean) =>
    me(['admin'], {
      admin: { role: 'verifier', permissions: ['verifier'], totpEnabled, twoFactorVerified },
    });

  it.each<[string, Pick<MeResponse, 'roles' | 'onboarding' | 'vet' | 'admin'>, HomeRoute]>([
    ['no roles yet', me([]), 'onboarding'],
    [
      'no consent yet',
      me(['farmer'], { onboarding: { consented: false, roleChosen: true } }),
      'onboarding',
    ],
    ['farmer only', me(['farmer']), 'farmer_home'],
    ['vet with no application', me(['vet']), 'vet_application'],
    ['vet draft', vet('draft'), 'vet_application'],
    ['vet submitted', vet('submitted'), 'vet_under_review'],
    ['vet under review', vet('under_review'), 'vet_under_review'],
    ['vet changes requested', vet('changes_requested'), 'vet_changes_requested'],
    ['vet rejected', vet('rejected'), 'vet_blocked'],
    ['vet suspended', vet('suspended'), 'vet_blocked'],
    ['vet approved', vet('approved'), 'vet_home'],
    ['admin without 2FA set up', adminMe(false, false), 'admin_2fa_setup'],
    ['admin before 2FA', adminMe(true, false), 'admin_2fa'],
    ['admin after 2FA', adminMe(true, true), 'admin_home'],
  ])('%s', (_name, input, route) => {
    expect(resolveHomeRoute(input).route).toBe(route);
  });

  it('multiple roles: last-used role wins, otherwise farmer, and all roles are offered', () => {
    const multi = me(['farmer', 'vet'], { vet: { verificationStatus: 'approved' } });
    expect(resolveHomeRoute(multi)).toEqual({
      route: 'farmer_home',
      role: 'farmer',
      roles: ['farmer', 'vet'],
    });
    expect(resolveHomeRoute(multi, 'vet').route).toBe('vet_home');
    // A stale last-used role the user no longer has is ignored.
    expect(resolveHomeRoute(multi, 'admin').route).toBe('farmer_home');
  });

  it('switching into admin goes through 2FA', () => {
    const both = me(['farmer', 'admin'], {
      admin: {
        role: 'support',
        permissions: ['support'],
        totpEnabled: true,
        twoFactorVerified: false,
      },
    });
    expect(resolveHomeRoute(both, 'admin').route).toBe('admin_2fa');
  });
});

describe('normalizePhone', () => {
  it.each([
    ['0712345678', '254712345678'],
    ['0712 345 678', '254712345678'],
    ['+254712345678', '254712345678'],
    ['254712345678', '254712345678'],
    ['0110-123-456', '254110123456'],
  ])('%s -> %s', (input, expected) => expect(normalizePhone(input)).toBe(expected));

  it.each(['', '12345', '0812345678', '+255712345678', '07123456789', 'phone'])(
    'rejects %s',
    (input) => expect(normalizePhone(input)).toBeNull(),
  );
});
