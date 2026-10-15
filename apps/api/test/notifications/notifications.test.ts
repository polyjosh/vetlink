import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { interpolate, messages, type Locale } from '@vetlink/i18n';
import type { FarmerBookingView } from '@vetlink/shared';
import { bookingOffers, devices, notifications, users } from '../../src/db/schema/index.js';
import {
  isQuietHours,
  msUntilQuietEnds,
  NOTIFICATION_KINDS,
  notify,
  type NotificationKind,
} from '../../src/modules/notifications/service.js';
import { Harness, type Session } from '../helpers/harness.js';
import {
  createTestDatabase,
  DB_SETUP_TIMEOUT_MS,
  testServerUrl,
  type TestDatabase,
} from '../helpers/test-db.js';

const SECRET = 'notify-webhook-secret-0123456789';

describe('notification templates', () => {
  // Realistic worst-case values: a long ward name, a 5-digit reference, a full phone number.
  const params = {
    ref: 48213,
    animal: "Ng'ombe wa maziwa",
    problem: 'Mgonjwa',
    ward: 'Kiambu Township Extra',
    km: 23,
    fee: 1500,
    vet: 'Dr. Wanjiru Kamau',
    phone: '254712345678',
    deposit: 200,
  };
  it.each(
    (['sw', 'en'] as Locale[]).flatMap((lang) =>
      (Object.keys(NOTIFICATION_KINDS) as NotificationKind[]).map((kind) => [lang, kind] as const),
    ),
  )('%s %s SMS fits one 160-character segment', (lang, kind) => {
    const sms = interpolate(messages[lang].notify[kind].sms, params);
    expect(sms.length).toBeLessThanOrEqual(160);
    expect(sms).not.toMatch(/\{\w+\}/); // every placeholder filled
  });

  it('quiet hours are 21:00 to 06:00 Nairobi time', () => {
    expect(isQuietHours(new Date('2026-10-15T17:59:00Z'))).toBe(false); // 20:59 EAT
    expect(isQuietHours(new Date('2026-10-15T18:00:00Z'))).toBe(true); // 21:00
    expect(isQuietHours(new Date('2026-10-15T02:59:00Z'))).toBe(true); // 05:59
    expect(isQuietHours(new Date('2026-10-15T03:00:00Z'))).toBe(false); // 06:00
    expect(msUntilQuietEnds(new Date('2026-10-15T19:00:00Z'))).toBe(8 * 3600 * 1000); // 22:00 → 06:00
  });
});

describe.skipIf(!testServerUrl)('notification router (database)', { timeout: 60_000 }, () => {
  let tdb: TestDatabase;
  let h: Harness;
  let wardId: number;

  beforeAll(async () => {
    tdb = await createTestDatabase();
  }, DB_SETUP_TIMEOUT_MS);
  afterAll(async () => {
    await tdb?.drop();
  }, DB_SETUP_TIMEOUT_MS);
  beforeEach(async () => {
    h = new Harness(tdb, { webhookSecret: SECRET });
    // Midday in Nairobi: outside quiet hours unless a test moves the clock.
    h.now = new Date('2026-10-15T09:00:00Z');
    wardId = await h.ward();
  });
  afterEach(async () => {
    await h.close();
  });

  /** Register this session's device for push (what the app does after sign-in). */
  async function withApp(s: Session) {
    const token = `ExponentPushToken[${randomUUID()}]`;
    await h.post('/v1/devices', { pushToken: token }, s.accessToken);
    return token;
  }

  async function paidBooking(farmer: Session) {
    const res = await h.post(
      '/v1/bookings',
      { species: 'cattle', problemType: 'sick' },
      farmer.accessToken,
      {
        'idempotency-key': `n-${randomUUID()}`,
      },
    );
    const id = res.json<FarmerBookingView>().id;
    await h.post('/v1/payments/stk', { bookingId: id }, farmer.accessToken);
    const checkout = h.gateway.last().checkoutRequestId;
    h.gateway.outcomes.set(checkout, {
      checkoutRequestId: checkout,
      resultCode: 0,
      resultDesc: 'ok',
    });
    await h.app.inject({
      method: 'POST',
      url: `/webhooks/mpesa?token=${SECRET}`,
      payload: {
        Body: {
          stkCallback: {
            MerchantRequestID: 'm',
            CheckoutRequestID: checkout,
            ResultCode: 0,
            ResultDesc: 'ok',
            CallbackMetadata: {
              Item: [{ Name: 'MpesaReceiptNumber', Value: `N${randomUUID().slice(0, 8)}` }],
            },
          },
        },
      },
    });
    return id;
  }

  /** Notification SMS to a number (login codes from signing in are left out). */
  const smsTo = (phone: string) =>
    h.sms
      .filter(
        (m) => m.phone === phone && !/VetLink code is|Nambari yako ya VetLink ni/.test(m.text),
      )
      .map((m) => m.text);
  const offerOf = async (bookingId: number) =>
    (await h.db.select().from(bookingOffers).where(eq(bookingOffers.bookingId, bookingId)))[0];

  describe('job offers', () => {
    it('a vet with the app gets a high-priority push; no confirmation in 15 s means an SMS too', async () => {
      const vet = await h.vet(wardId);
      const token = await withApp(vet);
      const farmer = await h.farmer(wardId);
      const id = await paidBooking(farmer);

      const [push] = h.push.to(token);
      expect(push).toMatchObject({ priority: 'high', channelId: 'offers', ttl: 120 });
      expect(push?.data).toMatchObject({ bookingId: id, kind: 'offer' });
      expect(push?.body).not.toContain(farmer.phone); // no farmer identity in an offer
      expect(smsTo(vet.phone)).toEqual([]);
      expect((await offerOf(id))?.channel).toBe('push');

      h.advance(14_000);
      await h.jobs.runDue();
      expect(smsTo(vet.phone)).toEqual([]);
      h.advance(2_000);
      await h.jobs.runDue();
      expect(smsTo(vet.phone)).toHaveLength(1);
      expect(smsTo(vet.phone)[0]).toMatch(new RegExp(`^VETLINK KAZI ${id}\\n`));
      expect(smsTo(vet.phone)[0]).toContain(`Y${id}`);
      expect((await offerOf(id))?.channel).toBe('both');
    });

    it('when the app confirms the push, no SMS is sent', async () => {
      const vet = await h.vet(wardId);
      const token = await withApp(vet);
      const farmer = await h.farmer(wardId);
      await paidBooking(farmer);
      const notificationId = Number(h.push.to(token)[0]?.data.notificationId);
      const ack = await h.post(`/v1/notifications/${notificationId}/read`, {}, vet.accessToken);
      expect(ack.statusCode).toBe(204);
      h.advance(20_000);
      await h.jobs.runDue();
      expect(smsTo(vet.phone)).toEqual([]);
    });

    it('a vet without the app gets the offer by SMS right away, in their language', async () => {
      const vet = await h.vet(wardId);
      await h.db.update(users).set({ language: 'en' }).where(eq(users.id, vet.userId));
      const farmer = await h.farmer(wardId);
      const id = await paidBooking(farmer);
      expect(smsTo(vet.phone)).toHaveLength(1);
      expect(smsTo(vet.phone)[0]).toMatch(
        new RegExp(
          `^VETLINK JOB ${id}\\nCow, Sick, .+ \\(~0km\\)\\nCall-out KES 600\\nReply Y${id} to accept, N${id} to decline$`,
        ),
      );
      expect((await offerOf(id))?.channel).toBe('sms');
    });

    it('a logged-out phone gets no push (SMS instead)', async () => {
      const vet = await h.vet(wardId);
      const token = await withApp(vet);
      await h.post('/v1/auth/logout', {}, vet.accessToken);
      const farmer = await h.farmer(wardId);
      await paidBooking(farmer);
      expect(h.push.to(token)).toEqual([]);
      expect(smsTo(vet.phone)).toHaveLength(1);
    });

    it('a dead push token is dropped and the SMS goes out at once', async () => {
      const vet = await h.vet(wardId);
      const token = await withApp(vet);
      h.push.unregistered.add(token);
      const farmer = await h.farmer(wardId);
      await paidBooking(farmer);
      expect(smsTo(vet.phone)).toHaveLength(1);
      const rows = await h.db.select().from(devices).where(eq(devices.userId, vet.userId));
      expect(rows.every((d) => d.pushToken === null)).toBe(true);
    });

    it('if the push service is down, the SMS goes out at once', async () => {
      const vet = await h.vet(wardId);
      await withApp(vet);
      h.push.down = true;
      const farmer = await h.farmer(wardId);
      await paidBooking(farmer);
      expect(smsTo(vet.phone)).toHaveLength(1);
    });
  });

  describe('farmer updates', () => {
    it('accepted, on the way, arrived, done: each reaches the farmer (SMS without the app)', async () => {
      const vet = await h.vet(wardId);
      const farmer = await h.farmer(wardId);
      const id = await paidBooking(farmer);
      const offer = await offerOf(id);
      await h.post(`/v1/bookings/${id}/offers/${offer?.id}/accept`, {}, vet.accessToken);
      await h.post(`/v1/bookings/${id}/status`, { status: 'en_route' }, vet.accessToken);
      await h.post(`/v1/bookings/${id}/status`, { status: 'in_service' }, vet.accessToken);
      await h.post(`/v1/bookings/${id}/complete`, { notes: 'ok' }, vet.accessToken);
      const texts = smsTo(farmer.phone);
      expect(texts).toHaveLength(4);
      expect(texts[0]).toContain(vet.phone); // contact revealed once matched
      expect(texts[3]).toContain(`R${id} 1-5`);
      // Retrying a step does not text again.
      await h.post(`/v1/bookings/${id}/complete`, { notes: 'ok' }, vet.accessToken);
      expect(smsTo(farmer.phone)).toHaveLength(4);
    });

    it('a farmer with the app gets pushes, and they appear in their inbox in their language', async () => {
      const vet = await h.vet(wardId);
      const farmer = await h.farmer(wardId);
      const token = await withApp(farmer);
      await h.db.update(users).set({ language: 'en' }).where(eq(users.id, farmer.userId));
      const id = await paidBooking(farmer);
      const offer = await offerOf(id);
      await h.post(`/v1/bookings/${id}/offers/${offer?.id}/accept`, {}, vet.accessToken);
      expect(h.push.to(token).map((p) => p.title)).toEqual(['A vet is coming']);
      const inbox = await h.get('/v1/notifications', farmer.accessToken);
      expect(inbox.json()).toMatchObject([
        { kind: 'booking_matched', title: 'A vet is coming', readAt: null },
      ]);
    });

    it('the vet is told when the farmer cancels an accepted job', async () => {
      const vet = await h.vet(wardId);
      const farmer = await h.farmer(wardId);
      const id = await paidBooking(farmer);
      const offer = await offerOf(id);
      await h.post(`/v1/bookings/${id}/offers/${offer?.id}/accept`, {}, vet.accessToken);
      await h.post(`/v1/bookings/${id}/cancel`, { reason: 'animal_recovered' }, farmer.accessToken);
      expect(smsTo(vet.phone).at(-1)).toMatch(new RegExp(`ombi ${id} limeghairiwa`));
    });
  });

  describe('quiet hours', () => {
    it('non-critical messages wait until 06:00; critical ones do not', async () => {
      const farmer = await h.farmer(wardId);
      h.now = new Date('2026-10-15T19:30:00Z'); // 22:30 EAT
      const quiet = await notify(
        h.ctx,
        { userId: farmer.userId, kind: 'booking_completed', params: { ref: 1, vet: 'Dr. X' } },
        h.app.log,
      );
      expect(quiet.via).toBe('deferred');
      const urgent = await notify(
        h.ctx,
        { userId: farmer.userId, kind: 'vet_arrived', params: { ref: 1, vet: 'Dr. X' } },
        h.app.log,
      );
      expect(urgent.via).toBe('sms');
      expect(smsTo(farmer.phone)).toHaveLength(1);

      h.advance(7 * 3600 * 1000 + 31 * 60 * 1000); // 06:01 EAT
      await h.jobs.runDue();
      expect(smsTo(farmer.phone)).toHaveLength(2);
      const [row] = await h.db.select().from(notifications).where(eq(notifications.id, quiet.id));
      expect(row?.smsSentAt).not.toBeNull();
    });

    it('a message is never sent twice, even if delivery is retried', async () => {
      const farmer = await h.farmer(wardId);
      const { id } = await notify(
        h.ctx,
        { userId: farmer.userId, kind: 'vet_arrived', params: { ref: 2, vet: 'Dr. Y' } },
        h.app.log,
      );
      const { deliver } = await import('../../src/modules/notifications/service.js');
      await deliver(h.ctx, id, h.app.log);
      await deliver(h.ctx, id, h.app.log);
      expect(smsTo(farmer.phone)).toHaveLength(1);
    });
  });

  it('users can only confirm their own notifications', async () => {
    const a = await h.farmer(wardId);
    const b = await h.farmer(wardId);
    const { id } = await notify(
      h.ctx,
      { userId: a.userId, kind: 'vet_arrived', params: { ref: 3, vet: 'Dr. Z' } },
      h.app.log,
    );
    expect((await h.post(`/v1/notifications/${id}/read`, {}, b.accessToken)).statusCode).toBe(404);
    expect((await h.post(`/v1/notifications/${id}/read`, {}, a.accessToken)).statusCode).toBe(204);
  });
});
