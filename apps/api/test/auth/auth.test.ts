import { Writable } from 'node:stream';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { normalizePhone, type AdminRole, type UserRole } from '@vetlink/shared';
import { buildApp } from '../../src/app.js';
import { createContext, type AppContext } from '../../src/context.js';
import {
  adminProfiles,
  auditLog,
  authSessions,
  devices,
  users,
  vets,
} from '../../src/db/schema/index.js';
import { memoryCounters } from '../../src/lib/counters.js';
import { fieldContext } from '../../src/lib/crypto.js';
import type { SmsSender } from '../../src/lib/sms.js';
import { access } from '../../src/modules/auth/access.js';
import { accessTokens } from '../../src/modules/auth/tokens.js';
import { base32Decode, hotp, totpStep } from '../../src/modules/auth/totp.js';
import {
  createTestDatabase,
  DB_SETUP_TIMEOUT_MS,
  testServerUrl,
  type TestDatabase,
} from '../helpers/test-db.js';

const KEY = Buffer.alloc(32, 5).toString('base64');
const JWT_SECRET = 'test-jwt-secret-that-is-long-enough-123';
const ADMIN_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// Every request commits to Postgres; on a WSL2 Docker volume that is slow, hence the timeout.
describe.skipIf(!testServerUrl)('auth and authorization (database)', { timeout: 30_000 }, () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;
  let ctx: AppContext;
  let now: Date;
  let sms: { phone: string; text: string }[];
  let smsFails: boolean;
  let logs: string[];
  let phoneSeq = 0;

  const advance = (ms: number) => {
    now = new Date(now.getTime() + ms);
  };
  // Fake numbers in a block no seed or fixture uses.
  const nextPhone = () => `25479${String(phoneSeq++).padStart(7, '0')}`;

  function build(options: { otpFixedCode?: string; trustProxy?: string[] } = {}) {
    sms = [];
    smsFails = false;
    logs = [];
    const sender: SmsSender = {
      async send(phone, text) {
        if (smsFails) throw new Error('provider down');
        sms.push({ phone, text });
      },
    };
    ctx = createContext({
      db: tdb.handle.db,
      counters: memoryCounters(() => now),
      sms: sender,
      dataEncryptionKey: KEY,
      jwtSecret: JWT_SECRET,
      otpFixedCode: options.otpFixedCode,
      clock: () => now,
    });
    const logStream = new Writable({
      write(chunk: Buffer, _enc, cb) {
        logs.push(chunk.toString());
        cb();
      },
    });
    app = buildApp({
      logLevel: 'info',
      deps: [],
      ctx,
      logStream,
      trustProxy: options.trustProxy,
      extraRoutes: (a) => {
        const ok = async () => ({ ok: true });
        a.get('/v1/probe/farmer', { config: { access: access.role('farmer') } }, ok);
        a.get('/v1/probe/vet', { config: { access: access.role('vet') } }, ok);
        a.get('/v1/admin/probe/verifier', { config: { access: access.admin('verifier') } }, ok);
        a.get('/v1/admin/probe/finance', { config: { access: access.admin('finance') } }, ok);
        a.post(
          '/v1/admin/probe/refund',
          { config: { access: access.admin('finance', { stepUp: true }) } },
          ok,
        );
      },
    });
    return app;
  }

  const post = (url: string, payload: object, token?: string, remoteAddress?: string) =>
    app.inject({
      method: 'POST',
      url,
      payload,
      ...(token && { headers: { authorization: `Bearer ${token}` } }),
      ...(remoteAddress && { remoteAddress }),
    });
  const get = (url: string, token?: string) =>
    app.inject({
      method: 'GET',
      url,
      ...(token && { headers: { authorization: `Bearer ${token}` } }),
    });
  const codeOf = (phone: string) => {
    const normalized = normalizePhone(phone);
    const last = [...sms].reverse().find((m) => m.phone === normalized);
    const code = /\b(\d{6})\b/.exec(last?.text ?? '')?.[1];
    if (!code) throw new Error('no OTP SMS');
    return code;
  };
  const device = { platform: 'android', appVersion: '1.0.0' };
  const verify = (phone: string, code: string, ip?: string) =>
    post('/v1/auth/otp/verify', { phone, code, device }, undefined, ip);
  const requestCode = (phone: string, ip?: string) =>
    post('/v1/auth/otp/request', { phone }, undefined, ip);

  interface Tokens {
    accessToken: string;
    refreshToken: string;
    isNewUser: boolean;
  }
  async function login(phone = nextPhone()): Promise<Tokens & { phone: string; userId: string }> {
    expect((await post('/v1/auth/otp/request', { phone })).statusCode).toBe(202);
    const res = await verify(phone, codeOf(phone));
    expect(res.statusCode).toBe(200);
    const tokens = res.json<Tokens>();
    const me = await get('/v1/me', tokens.accessToken);
    return { ...tokens, phone, userId: me.json<{ id: string }>().id };
  }

  async function setRoles(userId: string, roles: UserRole[]) {
    await tdb.handle.db.update(users).set({ roles, consentAt: now }).where(eq(users.id, userId));
  }

  /** An unenrolled admin gets the 72 h enrolment window a grant opens (M10). */
  async function makeAdmin(userId: string, adminRole: AdminRole, totpEnabled = true) {
    await tdb.handle.db.insert(adminProfiles).values({
      userId,
      adminRole,
      totpEnabled,
      totpEnrolExpiresAt: totpEnabled ? null : new Date(now.getTime() + 72 * HOUR),
      totpSecretEnc: totpEnabled
        ? ctx.crypto.encrypt(ADMIN_TOTP_SECRET, fieldContext('admin_profiles.totp_secret', userId))
        : null,
    });
  }

  const totpNow = (secret = ADMIN_TOTP_SECRET, offsetSteps = 0) =>
    hotp(base32Decode(secret), totpStep(now) + offsetSteps);

  async function adminSession(role: AdminRole) {
    const user = await login();
    await makeAdmin(user.userId, role);
    const res = await post('/v1/auth/2fa/verify', { code: totpNow() }, user.accessToken);
    expect(res.statusCode).toBe(204);
    // Codes are single-use; move to the next step so later codes in the test are fresh.
    advance(30_000);
    return user;
  }

  const errorCode = (res: LightMyRequestResponse) => res.json<{ code: string }>().code;

  beforeAll(async () => {
    tdb = await createTestDatabase();
  }, DB_SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await tdb?.drop();
  }, DB_SETUP_TIMEOUT_MS);

  beforeEach(() => {
    now = new Date('2026-10-15T06:00:00Z');
    build();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('OTP login', () => {
    it('signs up a new number, then signs the same account in again', async () => {
      const phone = nextPhone();
      const first = await login(phone);
      expect(first.isNewUser).toBe(true);
      const me = await get('/v1/me', first.accessToken);
      expect(me.json()).toMatchObject({
        phone,
        roles: [],
        onboarding: { consented: false, roleChosen: false },
        vet: null,
        admin: null,
      });

      const second = await login(phone);
      expect(second.isNewUser).toBe(false);
      expect(second.userId).toBe(first.userId);
    });

    it('treats 07…, +254… and spaced forms as the same account', async () => {
      const a = await login('0790 555 001');
      const b = await login('+254790555001');
      expect(b.userId).toBe(a.userId);
      const [row] = await tdb.handle.db.select().from(users).where(eq(users.id, a.userId));
      expect(row?.phone).toBe('254790555001');
    });

    it('rejects an invalid phone number', async () => {
      const res = await post('/v1/auth/otp/request', { phone: '12345' });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({
        code: 'invalid_phone',
        message_key: 'errors.invalid_phone',
        details: {},
      });
    });

    it('rejects malformed bodies with invalid_request', async () => {
      expect(errorCode(await post('/v1/auth/otp/request', {}))).toBe('invalid_request');
      const bad = await post('/v1/auth/otp/verify', { phone: nextPhone(), code: '12ab56', device });
      expect(bad.statusCode).toBe(400);
      expect(bad.json()).toMatchObject({ code: 'invalid_request', details: { fields: ['code'] } });
    });

    it('answers the same whether or not the number has an account (no enumeration)', async () => {
      const existing = await login();
      const a = await post('/v1/auth/otp/request', { phone: existing.phone });
      const b = await post('/v1/auth/otp/request', { phone: nextPhone() });
      expect([a.statusCode, a.body]).toEqual([b.statusCode, b.body]);
    });

    it('sends the code in the account language (Swahili by default)', async () => {
      const phone = nextPhone();
      await post('/v1/auth/otp/request', { phone });
      expect(sms.at(-1)?.text).toMatch(/^Nambari yako ya VetLink ni \d{6}\./);
      const user = await login(phone);
      await tdb.handle.db.update(users).set({ language: 'en' }).where(eq(users.id, user.userId));
      advance(10 * MINUTE); // past the per-phone SMS limit window
      await post('/v1/auth/otp/request', { phone });
      expect(sms.at(-1)?.text).toMatch(/^Your VetLink code is \d{6}\./);
    });

    it('rejects an expired code', async () => {
      const phone = nextPhone();
      await post('/v1/auth/otp/request', { phone });
      advance(5 * MINUTE);
      const res = await verify(phone, codeOf(phone));
      expect(res.statusCode).toBe(400);
      expect(errorCode(res)).toBe('otp_expired');
    });

    it('a new request supersedes the previous code', async () => {
      const phone = nextPhone();
      await post('/v1/auth/otp/request', { phone });
      const first = codeOf(phone);
      await post('/v1/auth/otp/request', { phone });
      const second = codeOf(phone);
      if (first !== second) expect(errorCode(await verify(phone, first))).toBe('otp_invalid');
      expect((await verify(phone, second)).statusCode).toBe(200);
    });

    it('burns a code after 5 wrong attempts', async () => {
      const phone = nextPhone();
      await post('/v1/auth/otp/request', { phone });
      const code = codeOf(phone);
      const wrong = code === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) expect(errorCode(await verify(phone, wrong))).toBe('otp_invalid');
      expect(errorCode(await verify(phone, code))).toBe('otp_invalid');
    });

    it('a code works exactly once, even for concurrent submissions', async () => {
      const phone = nextPhone();
      await post('/v1/auth/otp/request', { phone });
      const code = codeOf(phone);
      const results = await Promise.all([
        verify(phone, code),
        verify(phone, code),
        verify(phone, code),
      ]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 400, 400]);
      const users1 = await tdb.handle.db.select().from(users).where(eq(users.phone, phone));
      expect(users1).toHaveLength(1);
    });

    it('locks a phone for one IP after 10 wrong codes from that IP (brute force)', async () => {
      const phone = nextPhone();
      const attacker = '198.51.100.7';
      for (let round = 0; round < 2; round++) {
        await requestCode(phone, attacker);
        for (let i = 0; i < 5; i++) await verify(phone, '000000', attacker);
      }
      const locked = await requestCode(phone, attacker);
      expect(locked.statusCode).toBe(429);
      expect(errorCode(locked)).toBe('account_locked');
      expect(errorCode(await verify(phone, '000000', attacker))).toBe('account_locked');
      expect(logs.join('')).toContain('OTP lockout (phone and IP)');

      // The owner, on their own connection, is not locked out by someone else's guessing.
      expect((await login(phone)).accessToken).toBeTruthy();
      advance(HOUR);
      expect((await requestCode(phone, attacker)).statusCode).toBe(202);
    });

    it('does not count attempts when no code is live (nothing to guess, no lockout)', async () => {
      const phone = nextPhone();
      for (let i = 0; i < 40; i++) {
        expect(errorCode(await verify(phone, '000000', '198.51.100.8'))).toBe('otp_invalid');
      }
      expect((await login(phone)).accessToken).toBeTruthy();
    });

    it('locks the phone from every IP after 30 wrong codes in a day (distributed guessing)', async () => {
      const phone = nextPhone();
      for (let n = 0; n < 6; n++) {
        const ip = `198.51.100.${20 + n}`;
        expect((await requestCode(phone, ip)).statusCode).toBe(202);
        for (let i = 0; i < 5; i++) await verify(phone, '000000', ip);
      }
      expect(logs.join('')).toContain('OTP lockout (phone)');
      expect(errorCode(await requestCode(phone, '203.0.113.50'))).toBe('account_locked');
      advance(HOUR);
      expect((await login(phone)).accessToken).toBeTruthy();
    });

    it('rate-limits OTP SMS per phone+IP, per phone, and per IP', async () => {
      const phone = nextPhone();
      for (let i = 0; i < 3; i++) expect((await requestCode(phone)).statusCode).toBe(202);
      const limited = await requestCode(phone);
      expect(limited.statusCode).toBe(429);
      expect(errorCode(limited)).toBe('rate_limited');
      expect(sms.filter((m) => m.phone === phone)).toHaveLength(3);
      // Someone else exhausting a number's quota from their IP does not block the owner's IP...
      expect((await requestCode(phone, '203.0.113.60')).statusCode).toBe(202);
      // ...up to the per-phone cap of 10 an hour across all IPs.
      for (let i = 0; i < 6; i++) await requestCode(phone, `203.0.113.${61 + i}`);
      expect(errorCode(await requestCode(phone, '203.0.113.99'))).toBe('rate_limited');
      advance(HOUR);
      expect((await requestCode(phone)).statusCode).toBe(202);

      const ip = '203.0.113.9';
      for (let i = 0; i < 30; i++) {
        expect((await requestCode(nextPhone(), ip)).statusCode).toBe(202);
      }
      expect((await requestCode(nextPhone(), ip)).statusCode).toBe(429);
    });

    it('with TRUST_PROXY, limits use the client IP from X-Forwarded-For', async () => {
      await app.close();
      build({ trustProxy: ['127.0.0.1'] }); // inject() connects from 127.0.0.1, the "proxy"
      const phone = nextPhone();
      const from = (ip: string) =>
        app.inject({
          method: 'POST',
          url: '/v1/auth/otp/request',
          payload: { phone },
          headers: { 'x-forwarded-for': ip },
        });
      for (let i = 0; i < 3; i++) expect((await from('192.0.2.1')).statusCode).toBe(202);
      expect((await from('192.0.2.1')).statusCode).toBe(429);
      // Same proxy socket, different client: a separate phone+IP bucket.
      expect((await from('192.0.2.2')).statusCode).toBe(202);
    });

    it('without TRUST_PROXY, a forged X-Forwarded-For does not dodge the limits', async () => {
      const phone = nextPhone();
      const forged = (ip: string) =>
        app.inject({
          method: 'POST',
          url: '/v1/auth/otp/request',
          payload: { phone },
          headers: { 'x-forwarded-for': ip },
        });
      for (let i = 0; i < 3; i++) expect((await forged(`192.0.2.${10 + i}`)).statusCode).toBe(202);
      expect((await forged('192.0.2.99')).statusCode).toBe(429);
    });

    it('reports an SMS provider failure as sms_unavailable', async () => {
      smsFails = true;
      const res = await post('/v1/auth/otp/request', { phone: nextPhone() });
      expect(res.statusCode).toBe(503);
      expect(errorCode(res)).toBe('sms_unavailable');
    });

    it('uses OTP_FIXED_CODE when configured (dev shortcut)', async () => {
      await app.close();
      build({ otpFixedCode: '246810' });
      const phone = nextPhone();
      await post('/v1/auth/otp/request', { phone });
      expect((await verify(phone, '246810')).statusCode).toBe(200);
    });

    it('never logs the phone number, OTP, or tokens', async () => {
      const user = await login();
      await post('/v1/auth/refresh', { refreshToken: user.refreshToken });
      const out = logs.join('');
      expect(out).toContain('signed in');
      expect(out).not.toContain(user.phone);
      expect(out).not.toContain(codeOf(user.phone));
      expect(out).not.toContain(user.accessToken);
      expect(out).not.toContain(user.refreshToken);
    });
  });

  describe('tokens and sessions', () => {
    it('creates a device and a session at login', async () => {
      const user = await login();
      const [session] = await tdb.handle.db
        .select()
        .from(authSessions)
        .where(eq(authSessions.userId, user.userId));
      expect(session?.deviceId).toBeTruthy();
      const [dev] = await tdb.handle.db
        .select()
        .from(devices)
        .where(eq(devices.id, session?.deviceId ?? ''));
      expect(dev).toMatchObject({ platform: 'android', appVersion: '1.0.0' });
    });

    it('rotates refresh tokens', async () => {
      const user = await login();
      const r1 = await post('/v1/auth/refresh', { refreshToken: user.refreshToken });
      expect(r1.statusCode).toBe(200);
      const t1 = r1.json<Tokens>();
      expect(t1.refreshToken).not.toBe(user.refreshToken);
      expect((await get('/v1/me', t1.accessToken)).statusCode).toBe(200);
      const r2 = await post('/v1/auth/refresh', { refreshToken: t1.refreshToken });
      expect(r2.statusCode).toBe(200);
    });

    it('reusing a rotated refresh token revokes the whole session', async () => {
      const user = await login();
      const t1 = (
        await post('/v1/auth/refresh', { refreshToken: user.refreshToken })
      ).json<Tokens>();
      advance(2 * MINUTE);
      const reuse = await post('/v1/auth/refresh', { refreshToken: user.refreshToken });
      expect(reuse.statusCode).toBe(401);
      expect(errorCode(reuse)).toBe('refresh_invalid');
      // The legitimate holder's newer token and access token stop working too.
      expect((await post('/v1/auth/refresh', { refreshToken: t1.refreshToken })).statusCode).toBe(
        401,
      );
      expect((await get('/v1/me', t1.accessToken)).statusCode).toBe(401);
      const [session] = await tdb.handle.db
        .select()
        .from(authSessions)
        .where(eq(authSessions.userId, user.userId));
      expect(session?.revokedReason).toBe('refresh_token_reuse');
      expect(logs.join('')).toContain('refresh token reuse detected');
    });

    it('two simultaneous refreshes with the same token both succeed (no instant sign-out)', async () => {
      const user = await login();
      const [a, b] = await Promise.all([
        post('/v1/auth/refresh', { refreshToken: user.refreshToken }),
        post('/v1/auth/refresh', { refreshToken: user.refreshToken }),
      ]);
      expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
      // Exactly one of the two new tokens stays live; clients must refresh one at a time
      // (single-flight) so they keep that one. Using the retired one within the grace window
      // still works and does not revoke the session.
      const results = await Promise.all(
        [a, b].map((r) =>
          post('/v1/auth/refresh', { refreshToken: r.json<Tokens>().refreshToken }),
        ),
      );
      expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
    });

    it('allows a retry with the previous token within the grace window (lost response)', async () => {
      const user = await login();
      const lost = (
        await post('/v1/auth/refresh', { refreshToken: user.refreshToken })
      ).json<Tokens>();
      advance(20_000);
      const retry = await post('/v1/auth/refresh', { refreshToken: user.refreshToken });
      expect(retry.statusCode).toBe(200);
      const t2 = retry.json<Tokens>();
      expect((await post('/v1/auth/refresh', { refreshToken: t2.refreshToken })).statusCode).toBe(
        200,
      );
      // The response the client never saw is dead, and its use after the grace window is reuse.
      advance(2 * MINUTE);
      expect((await post('/v1/auth/refresh', { refreshToken: lost.refreshToken })).statusCode).toBe(
        401,
      );
    });

    it('refreshing two tokens of one session at once never deadlocks (no 500)', async () => {
      // Regression: locking the token row before the session row deadlocked here.
      for (let i = 0; i < 10; i++) {
        const user = await login();
        const first = await Promise.all(
          [1, 2].map(() => post('/v1/auth/refresh', { refreshToken: user.refreshToken })),
        );
        const second = await Promise.all(
          first.map((r) =>
            post('/v1/auth/refresh', { refreshToken: r.json<Tokens>().refreshToken }),
          ),
        );
        expect([...first, ...second].map((r) => r.statusCode)).not.toContain(500);
      }
    });

    it('rejects expired refresh tokens and expired access tokens', async () => {
      const user = await login();
      advance(16 * MINUTE);
      expect(errorCode(await get('/v1/me', user.accessToken))).toBe('unauthenticated');
      expect((await post('/v1/auth/refresh', { refreshToken: user.refreshToken })).statusCode).toBe(
        200,
      );
      const later = await login();
      advance(31 * 24 * HOUR);
      expect(
        (await post('/v1/auth/refresh', { refreshToken: later.refreshToken })).statusCode,
      ).toBe(401);
    });

    it('logout revokes the access token and the refresh token', async () => {
      const user = await login();
      const pushToken = 'ExponentPushToken[logout-test]';
      expect((await post('/v1/devices', { pushToken }, user.accessToken)).statusCode).toBe(204);
      expect((await post('/v1/auth/logout', {}, user.accessToken)).statusCode).toBe(204);
      // The logged-out phone stops receiving this account's notifications.
      expect(
        await tdb.handle.db.select().from(devices).where(eq(devices.pushToken, pushToken)),
      ).toHaveLength(0);
      expect((await get('/v1/me', user.accessToken)).statusCode).toBe(401);
      expect((await post('/v1/auth/refresh', { refreshToken: user.refreshToken })).statusCode).toBe(
        401,
      );
    });

    it('logging out one device leaves other sessions signed in', async () => {
      const phone = nextPhone();
      const a = await login(phone);
      const b = await login(phone);
      await post('/v1/auth/logout', {}, a.accessToken);
      expect((await get('/v1/me', b.accessToken)).statusCode).toBe(200);
    });

    it('a deleted account can neither use nor refresh its tokens', async () => {
      const user = await login();
      await tdb.handle.db.update(users).set({ deletedAt: now }).where(eq(users.id, user.userId));
      expect((await get('/v1/me', user.accessToken)).statusCode).toBe(401);
      expect((await post('/v1/auth/refresh', { refreshToken: user.refreshToken })).statusCode).toBe(
        401,
      );
    });

    it('rejects missing, malformed, and foreign-signed access tokens', async () => {
      const user = await login();
      expect(errorCode(await get('/v1/me'))).toBe('unauthenticated');
      expect((await get('/v1/me', 'not.a.jwt')).statusCode).toBe(401);
      const foreign = await accessTokens('another-secret-that-is-long-enough-xx').sign(
        {
          userId: user.userId,
          sessionId: '00000000-0000-4000-8000-000000000000',
          roles: ['admin'],
        },
        now,
      );
      expect((await get('/v1/me', foreign)).statusCode).toBe(401);
    });
  });

  describe('roles and admin authorization', () => {
    it('a farmer can use farmer routes but not vet or admin routes', async () => {
      const user = await login();
      await setRoles(user.userId, ['farmer']);
      expect((await get('/v1/probe/farmer', user.accessToken)).statusCode).toBe(200);
      const vetRes = await get('/v1/probe/vet', user.accessToken);
      expect(vetRes.statusCode).toBe(403);
      expect(errorCode(vetRes)).toBe('forbidden');
      const adminRes = await get('/v1/admin/probe/verifier', user.accessToken);
      expect(adminRes.statusCode).toBe(404);
      expect(errorCode(adminRes)).toBe('not_found');
      expect(logs.join('')).toContain('access denied');
    });

    it('roles come from the database, not the token', async () => {
      const user = await login();
      expect((await get('/v1/probe/farmer', user.accessToken)).statusCode).toBe(403);
      await setRoles(user.userId, ['farmer']);
      // Same token, roles granted since: allowed without logging in again.
      expect((await get('/v1/probe/farmer', user.accessToken)).statusCode).toBe(200);
    });

    it('a forged admin role claim on a valid session is refused like "not found"', async () => {
      const user = await login();
      const claims = await ctx.tokens.verify(user.accessToken, now);
      if (!claims) throw new Error('token did not verify');
      const forged = await ctx.tokens.sign({ ...claims, roles: ['farmer', 'vet', 'admin'] }, now);
      const res = await get('/v1/admin/probe/verifier', forged);
      expect(res.statusCode).toBe(404);
      expect((await get('/v1/me', forged)).json()).toMatchObject({ roles: [], admin: null });
    });

    it('an admin without 2FA is refused; after 2FA only their permission is unlocked', async () => {
      const user = await login();
      await makeAdmin(user.userId, 'verifier');
      const before = await get('/v1/admin/probe/verifier', user.accessToken);
      expect(before.statusCode).toBe(401);
      expect(errorCode(before)).toBe('two_factor_required');

      expect(
        (await post('/v1/auth/2fa/verify', { code: totpNow() }, user.accessToken)).statusCode,
      ).toBe(204);
      expect((await get('/v1/admin/probe/verifier', user.accessToken)).statusCode).toBe(200);
      expect((await get('/v1/admin/probe/finance', user.accessToken)).statusCode).toBe(404);
      expect((await get('/v1/me', user.accessToken)).json()).toMatchObject({
        roles: ['admin'],
        admin: { role: 'verifier', permissions: ['verifier'], twoFactorVerified: true },
      });
    });

    it('2FA is per session and expires after 8 hours', async () => {
      const user = await adminSession('super_admin');
      const otherDevice = await login(user.phone);
      expect(errorCode(await get('/v1/admin/probe/finance', otherDevice.accessToken))).toBe(
        'two_factor_required',
      );
      advance(8 * HOUR);
      const refreshed = (
        await post('/v1/auth/refresh', { refreshToken: user.refreshToken })
      ).json<Tokens>();
      expect(errorCode(await get('/v1/admin/probe/finance', refreshed.accessToken))).toBe(
        'two_factor_required',
      );
    });

    it('sensitive actions need a step-up within the last 5 minutes', async () => {
      const user = await adminSession('finance');
      const res = await post('/v1/admin/probe/refund', {}, user.accessToken);
      expect(res.statusCode).toBe(401);
      expect(errorCode(res)).toBe('step_up_required');
      expect(
        (await post('/v1/auth/step-up', { code: totpNow() }, user.accessToken)).statusCode,
      ).toBe(204);
      expect((await post('/v1/admin/probe/refund', {}, user.accessToken)).statusCode).toBe(200);
      advance(5 * MINUTE);
      expect(errorCode(await post('/v1/admin/probe/refund', {}, user.accessToken))).toBe(
        'step_up_required',
      );
    });

    it('step-up needs a 2FA-verified session first', async () => {
      const user = await login();
      await makeAdmin(user.userId, 'finance');
      const res = await post('/v1/auth/step-up', { code: totpNow() }, user.accessToken);
      expect(errorCode(res)).toBe('two_factor_required');
    });

    it('revoking the admin profile revokes admin access immediately', async () => {
      const user = await adminSession('verifier');
      expect((await get('/v1/admin/probe/verifier', user.accessToken)).statusCode).toBe(200);
      await tdb.handle.db
        .update(adminProfiles)
        .set({ revokedAt: now })
        .where(eq(adminProfiles.userId, user.userId));
      expect((await get('/v1/admin/probe/verifier', user.accessToken)).statusCode).toBe(404);
      expect((await get('/v1/me', user.accessToken)).json()).toMatchObject({
        roles: [],
        admin: null,
      });
    });

    it('non-admins get "not found" from the 2FA endpoints', async () => {
      const user = await login();
      for (const url of ['/v1/auth/2fa/setup', '/v1/auth/2fa/verify', '/v1/auth/step-up']) {
        const res = await post(url, { code: '123456' }, user.accessToken);
        expect([url, res.statusCode]).toEqual([url, 404]);
      }
    });
  });

  describe('admin TOTP 2FA', () => {
    it('enrols: setup, enable with a first code, recovery codes shown once', async () => {
      const user = await login();
      await makeAdmin(user.userId, 'support', false);
      expect(errorCode(await get('/v1/admin/probe/verifier', user.accessToken))).toBe(
        'two_factor_setup_required',
      );
      expect((await get('/v1/me', user.accessToken)).json()).toMatchObject({
        admin: { totpEnabled: false, twoFactorVerified: false },
      });

      const setup = await post('/v1/auth/2fa/setup', {}, user.accessToken);
      expect(setup.statusCode).toBe(200);
      const { secret, otpauthUri } = setup.json<{ secret: string; otpauthUri: string }>();
      expect(otpauthUri).toContain(`secret=${secret}`);
      expect(otpauthUri).not.toContain(user.phone);
      const [stored] = await tdb.handle.db
        .select()
        .from(adminProfiles)
        .where(eq(adminProfiles.userId, user.userId));
      expect(stored?.totpSecretEnc).not.toContain(secret);

      const wrong = await post('/v1/auth/2fa/enable', { code: '000000' }, user.accessToken);
      if (totpNow(secret) !== '000000') expect(errorCode(wrong)).toBe('two_factor_invalid');
      const enable = await post('/v1/auth/2fa/enable', { code: totpNow(secret) }, user.accessToken);
      expect(enable.statusCode).toBe(200);
      const { recoveryCodes } = enable.json<{ recoveryCodes: string[] }>();
      expect(recoveryCodes).toHaveLength(10);
      expect(new Set(recoveryCodes).size).toBe(10);
      expect(recoveryCodes[0]).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);

      expect((await get('/v1/me', user.accessToken)).json()).toMatchObject({
        admin: { totpEnabled: true, twoFactorVerified: true },
      });
      expect(errorCode(await post('/v1/auth/2fa/setup', {}, user.accessToken))).toBe(
        'two_factor_already_enabled',
      );
      const actions = (
        await tdb.handle.db.select().from(auditLog).where(eq(auditLog.actorUserId, user.userId))
      ).map((r) => r.action);
      expect(actions).toEqual(
        expect.arrayContaining(['admin.2fa_setup_started', 'admin.2fa_enabled']),
      );
    });

    it('rejects a replayed TOTP code', async () => {
      const user = await login();
      await makeAdmin(user.userId, 'support');
      const code = totpNow();
      expect((await post('/v1/auth/2fa/verify', { code }, user.accessToken)).statusCode).toBe(204);
      const other = await login(user.phone);
      const replay = await post('/v1/auth/2fa/verify', { code }, other.accessToken);
      expect(errorCode(replay)).toBe('two_factor_invalid');
    });

    it('accepts one step of clock drift', async () => {
      const user = await login();
      await makeAdmin(user.userId, 'support');
      const res = await post(
        '/v1/auth/2fa/verify',
        { code: totpNow(ADMIN_TOTP_SECRET, -1) },
        user.accessToken,
      );
      expect(res.statusCode).toBe(204);
    });

    it('locks 2FA for 15 minutes after 5 failures, audited and logged', async () => {
      const user = await login();
      await makeAdmin(user.userId, 'support');
      const wrong = totpNow() === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) {
        const res = await post('/v1/auth/2fa/verify', { code: wrong }, user.accessToken);
        expect(errorCode(res)).toBe('two_factor_invalid');
      }
      const locked = await post('/v1/auth/2fa/verify', { code: totpNow() }, user.accessToken);
      expect(locked.statusCode).toBe(429);
      expect(errorCode(locked)).toBe('two_factor_locked');
      const actions = (
        await tdb.handle.db.select().from(auditLog).where(eq(auditLog.actorUserId, user.userId))
      ).map((r) => r.action);
      expect(actions.filter((a) => a === 'admin.2fa_failed')).toHaveLength(5);
      expect(actions).toContain('admin.2fa_locked');
      expect(logs.join('')).toContain('admin 2FA locked');

      advance(15 * MINUTE);
      // The 15-minute access token has expired too; refresh it first.
      const fresh = (
        await post('/v1/auth/refresh', { refreshToken: user.refreshToken })
      ).json<Tokens>();
      expect(
        (await post('/v1/auth/2fa/verify', { code: totpNow() }, fresh.accessToken)).statusCode,
      ).toBe(204);
    });

    it('a recovery code satisfies 2FA exactly once', async () => {
      const user = await login();
      await makeAdmin(user.userId, 'support', false);
      const { secret } = (await post('/v1/auth/2fa/setup', {}, user.accessToken)).json<{
        secret: string;
      }>();
      const { recoveryCodes } = (
        await post('/v1/auth/2fa/enable', { code: totpNow(secret) }, user.accessToken)
      ).json<{ recoveryCodes: string[] }>();
      const code = recoveryCodes[3] ?? '';

      const s2 = await login(user.phone);
      // Case and dash are forgiven when typing it in.
      const res = await post(
        '/v1/auth/2fa/verify',
        { recoveryCode: code.toLowerCase().replace('-', '') },
        s2.accessToken,
      );
      expect(res.statusCode).toBe(204);
      expect((await get('/v1/admin/probe/verifier', s2.accessToken)).statusCode).toBe(404);
      expect((await get('/v1/me', s2.accessToken)).json()).toMatchObject({
        admin: { twoFactorVerified: true },
      });

      const s3 = await login(user.phone);
      const again = await post('/v1/auth/2fa/verify', { recoveryCode: code }, s3.accessToken);
      expect(errorCode(again)).toBe('two_factor_invalid');
      const [row] = await tdb.handle.db
        .select()
        .from(adminProfiles)
        .where(eq(adminProfiles.userId, user.userId));
      expect(row?.recoveryCodesHash).toHaveLength(9);
    });

    it('a recovery code used from two sessions at once works exactly once', async () => {
      const user = await login();
      await makeAdmin(user.userId, 'support', false);
      const { secret } = (await post('/v1/auth/2fa/setup', {}, user.accessToken)).json<{
        secret: string;
      }>();
      const { recoveryCodes } = (
        await post('/v1/auth/2fa/enable', { code: totpNow(secret) }, user.accessToken)
      ).json<{ recoveryCodes: string[] }>();
      const [s1, s2] = [await login(user.phone), await login(user.phone)];
      const results = await Promise.all(
        [s1, s2].map((sess) =>
          post('/v1/auth/2fa/verify', { recoveryCode: recoveryCodes[0] }, sess.accessToken),
        ),
      );
      expect(results.map((r) => r.statusCode).sort()).toEqual([204, 401]);
    });

    it('enrolment is only open inside the window opened by grant or reset', async () => {
      const user = await login();
      await makeAdmin(user.userId, 'support', false);
      advance(72 * HOUR);
      const fresh = await login(user.phone);
      const res = await post('/v1/auth/2fa/setup', {}, fresh.accessToken);
      expect(res.statusCode).toBe(403);
      expect(errorCode(res)).toBe('two_factor_enrolment_closed');

      // An admin profile with no window at all (e.g. granted without one) cannot enrol either.
      const other = await login();
      await makeAdmin(other.userId, 'support', false);
      await tdb.handle.db
        .update(adminProfiles)
        .set({ totpEnrolExpiresAt: null })
        .where(eq(adminProfiles.userId, other.userId));
      expect(errorCode(await post('/v1/auth/2fa/setup', {}, other.accessToken))).toBe(
        'two_factor_enrolment_closed',
      );
    });

    it('enrolling closes the window, so a second authenticator cannot be added', async () => {
      const user = await login();
      await makeAdmin(user.userId, 'support', false);
      const { secret } = (await post('/v1/auth/2fa/setup', {}, user.accessToken)).json<{
        secret: string;
      }>();
      await post('/v1/auth/2fa/enable', { code: totpNow(secret) }, user.accessToken);
      const [row] = await tdb.handle.db
        .select()
        .from(adminProfiles)
        .where(eq(adminProfiles.userId, user.userId));
      expect(row?.totpEnrolExpiresAt).toBeNull();
    });

    it('a super admin with step-up resets another admin, who must enrol again', async () => {
      const target = await adminSession('verifier');
      expect((await get('/v1/admin/probe/verifier', target.accessToken)).statusCode).toBe(200);
      const boss = await adminSession('super_admin');
      const url = `/v1/admin/users/${target.userId}/2fa/reset`;

      expect(errorCode(await post(url, {}, boss.accessToken))).toBe('step_up_required');
      await post('/v1/auth/step-up', { code: totpNow() }, boss.accessToken);
      const res = await post(url, {}, boss.accessToken);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        enrolExpiresAt: new Date(now.getTime() + 72 * HOUR).toISOString(),
      });

      // The target's sessions lose 2FA and the old authenticator no longer works.
      expect(errorCode(await get('/v1/admin/probe/verifier', target.accessToken))).toBe(
        'two_factor_setup_required',
      );
      advance(30_000);
      expect(
        errorCode(await post('/v1/auth/2fa/verify', { code: totpNow() }, target.accessToken)),
      ).toBe('two_factor_setup_required');
      // ...and can enrol a new one inside the window.
      const { secret } = (await post('/v1/auth/2fa/setup', {}, target.accessToken)).json<{
        secret: string;
      }>();
      expect(
        (await post('/v1/auth/2fa/enable', { code: totpNow(secret) }, target.accessToken))
          .statusCode,
      ).toBe(200);

      const audits = await tdb.handle.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.entityId, target.userId));
      expect(audits.find((a) => a.action === 'admin.2fa_reset')?.actorUserId).toBe(boss.userId);
    });

    it('2FA reset: not for other admin roles, not on yourself, not on non-admins', async () => {
      const verifier = await adminSession('verifier');
      const boss = await adminSession('super_admin');
      const plain = await login();
      expect(
        (await post(`/v1/admin/users/${boss.userId}/2fa/reset`, {}, verifier.accessToken))
          .statusCode,
      ).toBe(404);
      await post('/v1/auth/step-up', { code: totpNow() }, boss.accessToken);
      expect(
        errorCode(await post(`/v1/admin/users/${boss.userId}/2fa/reset`, {}, boss.accessToken)),
      ).toBe('forbidden');
      expect(
        errorCode(await post(`/v1/admin/users/${plain.userId}/2fa/reset`, {}, boss.accessToken)),
      ).toBe('not_found');
      expect(
        errorCode(await post('/v1/admin/users/not-a-uuid/2fa/reset', {}, boss.accessToken)),
      ).toBe('invalid_request');
    });
  });

  describe('GET /v1/me and devices', () => {
    it('reports roles, consent and vet verification status', async () => {
      const user = await login();
      await setRoles(user.userId, ['farmer', 'vet']);
      await tdb.handle.db
        .insert(vets)
        .values({ userId: user.userId, type: 'vet', verificationStatus: 'submitted' });
      expect((await get('/v1/me', user.accessToken)).json()).toMatchObject({
        roles: ['farmer', 'vet'],
        onboarding: { consented: true, roleChosen: true },
        vet: { verificationStatus: 'submitted' },
        admin: null,
      });
    });

    it('answers not_found for a session without a device', async () => {
      const user = await login();
      const [session] = await tdb.handle.db
        .insert(authSessions)
        .values({ userId: user.userId })
        .returning({ id: authSessions.id });
      const token = await ctx.tokens.sign(
        { userId: user.userId, sessionId: session?.id ?? '', roles: [] },
        now,
      );
      expect(errorCode(await post('/v1/devices', { pushToken: 'x' }, token))).toBe('not_found');
    });

    it('a session revoked for token reuse also stops push to its device', async () => {
      const user = await login();
      const pushToken = 'ExponentPushToken[reuse-test]';
      await post('/v1/devices', { pushToken }, user.accessToken);
      await post('/v1/auth/refresh', { refreshToken: user.refreshToken });
      advance(2 * MINUTE);
      await post('/v1/auth/refresh', { refreshToken: user.refreshToken });
      expect(
        await tdb.handle.db.select().from(devices).where(eq(devices.pushToken, pushToken)),
      ).toHaveLength(0);
    });

    it('registers a push token for this device and detaches it from any other account', async () => {
      const a = await login();
      const b = await login();
      const pushToken = 'ExponentPushToken[test-token-1]';
      expect((await post('/v1/devices', { pushToken }, a.accessToken)).statusCode).toBe(204);
      // The phone changes hands: account B signs in on it and registers the same token.
      expect(
        (
          await post(
            '/v1/devices',
            { pushToken, appVersion: '1.1.0', notificationsEnabled: false },
            b.accessToken,
          )
        ).statusCode,
      ).toBe(204);
      const rows = await tdb.handle.db
        .select()
        .from(devices)
        .where(eq(devices.pushToken, pushToken));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        userId: b.userId,
        appVersion: '1.1.0',
        notificationsEnabled: false,
      });
      expect(errorCode(await post('/v1/devices', { pushToken: 5 }, a.accessToken))).toBe(
        'invalid_request',
      );
    });
  });
});
