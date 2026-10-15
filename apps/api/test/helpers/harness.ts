import { Writable } from 'node:stream';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import {
  normalizePhone,
  type AdminRole,
  type UserRole,
  type VerificationStatus,
} from '@vetlink/shared';
import { buildApp, type AppOptions } from '../../src/app.js';
import { createContext, type AppContext } from '../../src/context.js';
import { adminProfiles, farmers, locations, users, vets } from '../../src/db/schema/index.js';
import { inlineJobs } from '../../src/jobs/queue.js';
import { memoryCounters } from '../../src/lib/counters.js';
import { fieldContext } from '../../src/lib/crypto.js';
import { base32Decode, hotp, totpStep } from '../../src/modules/auth/totp.js';
import { FakeGateway } from './fake-gateway.js';
import { FakePush } from './fake-push.js';
import { FakeStorage } from './fake-storage.js';
import type { TestDatabase } from './test-db.js';

export const TEST_KEY = Buffer.alloc(32, 5).toString('base64');
export const TEST_JWT_SECRET = 'test-jwt-secret-that-is-long-enough-123';
export const TEST_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

export interface Session {
  phone: string;
  userId: string;
  accessToken: string;
  refreshToken: string;
}

/**
 * An app on a throwaway database with a controllable clock, captured SMS and logs, and helpers
 * to sign in and create farmers, vets and admins. One per test (cheap); the database is shared.
 */
export class Harness {
  now = new Date('2026-10-15T06:00:00Z');
  sms: { phone: string; text: string }[] = [];
  logs: string[] = [];
  ctx: AppContext;
  app: FastifyInstance;
  gateway = new FakeGateway();
  push = new FakePush();
  storage = new FakeStorage();
  jobs: ReturnType<typeof inlineJobs>;
  private static phoneSeq = 0;
  private static wardSeq = 0;

  constructor(
    readonly tdb: TestDatabase,
    options: Pick<
      AppOptions,
      'extraRoutes' | 'trustProxy' | 'webhookSecret' | 'echoSmsReplies'
    > = {},
  ) {
    this.jobs = inlineJobs(
      () => this.ctx,
      () => this.app.log,
    );
    this.ctx = createContext({
      db: tdb.handle.db,
      payments: this.gateway,
      push: this.push,
      jobs: this.jobs,
      storage: this.storage,
      counters: memoryCounters(() => this.now),
      sms: {
        send: async (phone, text) => {
          this.sms.push({ phone, text });
        },
      },
      dataEncryptionKey: TEST_KEY,
      jwtSecret: TEST_JWT_SECRET,
      clock: () => this.now,
    });
    this.app = buildApp({
      logLevel: 'info',
      deps: [],
      ctx: this.ctx,
      logStream: new Writable({
        write: (chunk: Buffer, _enc, cb) => {
          this.logs.push(chunk.toString());
          cb();
        },
      }),
      ...options,
    });
  }

  get db() {
    return this.tdb.handle.db;
  }

  advance(ms: number): void {
    this.now = new Date(this.now.getTime() + ms);
  }

  /** Fake numbers in a block no seed uses; unique across the whole test run. */
  static nextPhone(): string {
    return `25477${String(Harness.phoneSeq++).padStart(7, '0')}`;
  }

  request(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    options: { token?: string; body?: object; headers?: Record<string, string> } = {},
  ): Promise<LightMyRequestResponse> {
    return this.app.inject({
      method,
      url,
      ...(options.body && { payload: options.body }),
      headers: {
        ...(options.token && { authorization: `Bearer ${options.token}` }),
        ...options.headers,
      },
    });
  }

  get(url: string, token?: string) {
    return this.request('GET', url, token ? { token } : {});
  }

  post(url: string, body: object, token?: string, headers?: Record<string, string>) {
    return this.request('POST', url, {
      body,
      ...(token && { token }),
      ...(headers && { headers }),
    });
  }

  /** Sign in with OTP (creating the account if new). */
  async login(phone = Harness.nextPhone()): Promise<Session> {
    const req = await this.post('/v1/auth/otp/request', { phone });
    if (req.statusCode !== 202) throw new Error(`otp request failed: ${req.body}`);
    const normalized = normalizePhone(phone);
    const text = [...this.sms].reverse().find((m) => m.phone === normalized)?.text ?? '';
    const code = /\b(\d{6})\b/.exec(text)?.[1] ?? '';
    const res = await this.post('/v1/auth/otp/verify', {
      phone,
      code,
      device: { platform: 'android', appVersion: '1.0.0' },
    });
    if (res.statusCode !== 200) throw new Error(`otp verify failed: ${res.body}`);
    const tokens = res.json<{ accessToken: string; refreshToken: string }>();
    const me = await this.get('/v1/me', tokens.accessToken);
    return { ...tokens, phone: normalized ?? phone, userId: me.json<{ id: string }>().id };
  }

  /**
   * A ward of its own: about 66 km from the previous one, beyond even a widened matching radius,
   * so vets from other tests never count as nearby. Use `near` for a ward close to another.
   */
  async ward(
    name = `Ward ${Harness.wardSeq}`,
    position = { lat: -1.1 + Harness.wardSeq * 0.6, lng: 36.8 },
  ): Promise<number> {
    Harness.wardSeq += 1;
    const [row] = await this.db
      .insert(locations)
      .values({ county: 'Testcounty', subCounty: 'Testsub', ward: name, ...position })
      .returning({ id: locations.id });
    if (!row) throw new Error('ward insert failed');
    return row.id;
  }

  /** A ward `km` north of another (1° latitude is about 111 km). */
  async wardNear(wardId: number, km: number): Promise<number> {
    const [base] = await this.db.select().from(locations).where(eq(locations.id, wardId));
    if (base?.lat == null || base.lng == null) throw new Error('base ward has no position');
    return this.ward(`Near ${Harness.wardSeq}`, { lat: base.lat + km / 111.2, lng: base.lng });
  }

  async setRoles(userId: string, roles: UserRole[]): Promise<void> {
    await this.db
      .update(users)
      .set({ roles, consentAt: this.now, name: `Test ${roles.join('+') || 'user'}` })
      .where(eq(users.id, userId));
  }

  /** A signed-in farmer with a profile in `wardId`. */
  async farmer(wardId: number): Promise<Session> {
    const s = await this.login();
    await this.setRoles(s.userId, ['farmer']);
    await this.db.insert(farmers).values({ userId: s.userId, wardId, farmNotes: 'Blue gate' });
    return s;
  }

  /** A signed-in vet with the given verification status (approved vets start online). */
  async vet(
    wardId: number,
    status: VerificationStatus = 'approved',
    options: {
      specialties?: string[];
      fee?: number | null;
      radiusKm?: number;
      online?: boolean;
      rating?: string | null;
    } = {},
  ): Promise<Session> {
    const s = await this.login();
    await this.setRoles(s.userId, ['vet']);
    await this.db.insert(vets).values({
      userId: s.userId,
      type: 'vet',
      verificationStatus: status,
      wardId,
      specialties: options.specialties ?? ['cattle', 'goat', 'sheep'],
      services: ['treatment', 'vaccination'],
      baseCallOutFee: options.fee === undefined ? 600 : options.fee,
      serviceRadiusKm: options.radiusKm ?? 50,
      rating: options.rating ?? null,
      isAvailable: status === 'approved' && (options.online ?? true),
    });
    return s;
  }

  totp(offsetSteps = 0): string {
    return hotp(base32Decode(TEST_TOTP_SECRET), totpStep(this.now) + offsetSteps);
  }

  /** A signed-in admin who has passed 2FA on this session. */
  async admin(role: AdminRole): Promise<Session> {
    const s = await this.login();
    await this.db.insert(adminProfiles).values({
      userId: s.userId,
      adminRole: role,
      totpEnabled: true,
      totpSecretEnc: this.ctx.crypto.encrypt(
        TEST_TOTP_SECRET,
        fieldContext('admin_profiles.totp_secret', s.userId),
      ),
    });
    const res = await this.post('/v1/auth/2fa/verify', { code: this.totp() }, s.accessToken);
    if (res.statusCode !== 204) throw new Error(`2fa failed: ${res.body}`);
    this.advance(30_000); // codes are single-use; later codes come from the next step
    return s;
  }

  async stepUp(s: Session): Promise<void> {
    const res = await this.post('/v1/auth/step-up', { code: this.totp() }, s.accessToken);
    if (res.statusCode !== 204) throw new Error(`step-up failed: ${res.body}`);
  }

  close(): Promise<void> {
    return this.app.close();
  }
}

export const errorCode = (res: LightMyRequestResponse) => res.json<{ code: string }>().code;
