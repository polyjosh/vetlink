import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FarmerBookingView } from '@vetlink/shared';
import {
  auditLog,
  bookingOffers,
  bookings,
  locations,
  payments,
  vets,
  walletEntries,
} from '../../src/db/schema/index.js';
import { Harness, MINUTE, errorCode, type Session } from '../helpers/harness.js';
import {
  createTestDatabase,
  DB_SETUP_TIMEOUT_MS,
  testServerUrl,
  type TestDatabase,
} from '../helpers/test-db.js';

const SECRET = 'matching-webhook-secret-0123456789';

describe.skipIf(!testServerUrl)('matching and dispatch (database)', { timeout: 60_000 }, () => {
  let tdb: TestDatabase;
  let h: Harness;
  let farmWard: number;
  let farmer: Session;

  beforeAll(async () => {
    tdb = await createTestDatabase();
  }, DB_SETUP_TIMEOUT_MS);
  afterAll(async () => {
    await tdb?.drop();
  }, DB_SETUP_TIMEOUT_MS);
  beforeEach(async () => {
    h = new Harness(tdb, { webhookSecret: SECRET });
    farmWard = await h.ward();
    farmer = await h.farmer(farmWard);
  });
  afterEach(async () => {
    await h.close();
  });

  /** An approved, online vet `km` from the farm. */
  async function vetAt(
    km: number,
    options: Parameters<Harness['vet']>[2] = {},
    status: Parameters<Harness['vet']>[1] = 'approved',
  ) {
    return h.vet(await h.wardNear(farmWard, km), status, options);
  }

  /** Book and pay the deposit: the paid callback starts dispatch (jobs run inline). */
  async function paidBooking(body: object = { species: 'cattle', problemType: 'sick' }) {
    const res = await h.post('/v1/bookings', body, farmer.accessToken, {
      'idempotency-key': `m-${randomUUID()}`,
    });
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
              Item: [{ Name: 'MpesaReceiptNumber', Value: `M${randomUUID().slice(0, 8)}` }],
            },
          },
        },
      },
    });
    return id;
  }

  const offers = (bookingId: number) =>
    h.db
      .select()
      .from(bookingOffers)
      .where(eq(bookingOffers.bookingId, bookingId))
      .orderBy(bookingOffers.id);
  const offeredTo = async (bookingId: number, wave?: number) =>
    (await offers(bookingId))
      .filter((o) => wave === undefined || o.wave === wave)
      .map((o) => o.vetId);
  const statusOf = async (bookingId: number) =>
    (await h.db.select().from(bookings).where(eq(bookings.id, bookingId)))[0]?.status;

  describe('eligibility', () => {
    it('offers only approved, online vets who treat the species, in range, and free', async () => {
      const good = await vetAt(2);
      const busy = await vetAt(2);
      await vetAt(1, {}, 'submitted');
      await vetAt(1, {}, 'suspended');
      await vetAt(1, { online: false });
      await vetAt(1, { specialties: ['poultry'] });
      await vetAt(30); // beyond the 25 km default
      await vetAt(10, { radiusKm: 5 }); // farther than the vet's own radius
      // `busy` already has an active job.
      const other = await h.farmer(farmWard);
      const [job] = await h.db
        .insert(bookings)
        .values({
          farmerId: other.userId,
          vetId: busy.userId,
          species: 'cattle',
          problemType: 'sick',
          sourceChannel: 'web',
          wardId: farmWard,
          status: 'matched',
          feeQuoted: 500,
        })
        .returning({ id: bookings.id });
      expect(job).toBeDefined();

      const id = await paidBooking();
      expect(await statusOf(id)).toBe('pending');
      expect(await offeredTo(id, 1)).toEqual([good.userId]);
    });

    it('a goat request reaches a vet who lists sheep (small ruminants)', async () => {
      const sheepVet = await vetAt(2, { specialties: ['sheep'] });
      const id = await paidBooking({ species: 'goat', problemType: 'injury' });
      expect(await offeredTo(id)).toEqual([sheepVet.userId]);
    });

    it('a fresh live location counts; a stale one falls back to the base ward', async () => {
      const mobile = await vetAt(60); // base ward far away
      // Live pin on the farm (test wards sit outside Kenya's bounds, so set it directly; the
      // endpoint is covered below).
      const [fw] = await h.db.select().from(locations).where(eq(locations.id, farmWard));
      await h.db
        .update(vets)
        .set({
          liveLat: fw?.lat ?? 0,
          liveLng: fw?.lng ?? 0,
          liveLocationAt: h.now,
          shareLiveLocation: true,
        })
        .where(eq(vets.userId, mobile.userId));
      const fresh = await paidBooking();
      expect(await offeredTo(fresh)).toEqual([mobile.userId]);

      await h.db
        .update(vets)
        .set({ liveLocationAt: new Date(h.now.getTime() - 16 * MINUTE) })
        .where(eq(vets.userId, mobile.userId));
      const stale = await paidBooking();
      expect(await offeredTo(stale)).toEqual([]);
    });

    it('the live-location endpoint opts in, and DELETE forgets the pin', async () => {
      const v = await vetAt(1);
      const on = await h.request('PUT', '/v1/vets/me/location', {
        token: v.accessToken,
        body: { lat: -1.05, lng: 36.77 },
      });
      expect(on.json()).toMatchObject({ shareLiveLocation: true });
      const off = await h.request('DELETE', '/v1/vets/me/location', { token: v.accessToken });
      expect(off.json()).toMatchObject({ shareLiveLocation: false });
      const [row] = await h.db.select().from(vets).where(eq(vets.userId, v.userId));
      expect([row?.liveLat, row?.liveLng, row?.liveLocationAt]).toEqual([null, null, null]);
      expect(
        (
          await h.request('PUT', '/v1/vets/me/location', {
            token: v.accessToken,
            body: { lat: 51.5, lng: -0.1 },
          })
        ).statusCode,
      ).toBe(400);
    });
  });

  describe('waves', () => {
    it('wave 1 is the 3 best (closest first); after 90 s wave 2 takes the next 3', async () => {
      const byDistance = [];
      for (const km of [5, 1, 4, 2, 3]) byDistance.push({ km, s: await vetAt(km) });
      const ids = Object.fromEntries(byDistance.map((v) => [v.km, v.s.userId]));
      const id = await paidBooking();
      expect(await offeredTo(id, 1)).toEqual([ids[1], ids[2], ids[3]]);

      h.advance(89_000);
      await h.jobs.runDue();
      expect(await offeredTo(id, 2)).toEqual([]);
      h.advance(2_000);
      await h.jobs.runDue();
      expect(await offeredTo(id, 2)).toEqual([ids[4], ids[5]]);
      const wave1 = (await offers(id)).filter((o) => o.wave === 1);
      expect(wave1.map((o) => o.response)).toEqual(['timeout', 'timeout', 'timeout']);
    });

    it('when everyone in a wave declines, the next wave goes out at once', async () => {
      const near = await vetAt(1);
      const next = await vetAt(3);
      const id = await paidBooking();
      expect((await offeredTo(id, 1)).sort()).toEqual([near.userId, next.userId].sort());
      for (const o of await offers(id)) {
        const who = o.vetId === near.userId ? near : next;
        await h.post(`/v1/bookings/${id}/offers/${o.id}/decline`, {}, who.accessToken);
      }
      // Nobody else in range: straight to "still searching", without waiting 90 s.
      const audits = await h.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.entityId, String(id)));
      expect(audits.map((a) => a.action)).toContain('booking.unmatched');
    });

    it('wave 3 widens the radius by half', async () => {
      const near = await vetAt(2);
      const far = await vetAt(33); // outside 25 km, inside 37.5 km
      const id = await paidBooking();
      expect(await offeredTo(id, 1)).toEqual([near.userId]);
      h.advance(91_000);
      await h.jobs.runDue();
      // Wave 2 finds nobody new within 25 km, so wave 3 goes straight out at 37.5 km.
      expect(await offeredTo(id, 3)).toEqual([far.userId]);
    });

    it('an emergency goes to everyone eligible at once, with a 45 s countdown', async () => {
      const all = [];
      for (const km of [1, 2, 3, 4, 5]) all.push((await vetAt(km)).userId);
      const id = await paidBooking({ species: 'cattle', problemType: 'sick', isEmergency: true });
      expect((await offeredTo(id, 1)).sort()).toEqual([...all].sort());
      h.advance(46_000);
      await h.jobs.runDue();
      expect((await offers(id)).every((o) => o.response === 'timeout')).toBe(true);
    });

    it('accepting stops the waves; the farmer hears who is coming', async () => {
      const v1 = await vetAt(1);
      await vetAt(2);
      await vetAt(3);
      await vetAt(4);
      const id = await paidBooking();
      const [mine] = (await offers(id)).filter((o) => o.vetId === v1.userId);
      expect(
        (await h.post(`/v1/bookings/${id}/offers/${mine?.id}/accept`, {}, v1.accessToken))
          .statusCode,
      ).toBe(200);
      h.advance(5 * MINUTE);
      await h.jobs.runDue();
      expect(await offeredTo(id, 2)).toEqual([]);
      expect(await statusOf(id)).toBe('matched');
      const sms = h.sms.filter((m) => m.phone === farmer.phone).map((m) => m.text);
      expect(sms.some((t) => t.includes(v1.phone))).toBe(true);
    });

    it('two offered vets accept at the same moment: exactly one gets the job', async () => {
      const a = await vetAt(1);
      const b = await vetAt(2);
      const id = await paidBooking();
      const os = await offers(id);
      const offerOf = (s: Session) => os.find((o) => o.vetId === s.userId)?.id;
      const [ra, rb] = await Promise.all([
        h.post(`/v1/bookings/${id}/offers/${offerOf(a)}/accept`, {}, a.accessToken),
        h.post(`/v1/bookings/${id}/offers/${offerOf(b)}/accept`, {}, b.accessToken),
      ]);
      expect([ra.statusCode, rb.statusCode].sort()).toEqual([200, 409]);
    });

    it('a vet who releases the job hands it to the next wave, never back to them', async () => {
      const v1 = await vetAt(1);
      const v2 = await vetAt(10);
      const id = await paidBooking();
      // Both fit in wave 1; v1 accepts, then releases.
      const os = await offers(id);
      const mine = os.find((o) => o.vetId === v1.userId);
      await h.post(`/v1/bookings/${id}/offers/${mine?.id}/accept`, {}, v1.accessToken);
      await h.post(`/v1/bookings/${id}/release`, {}, v1.accessToken);
      expect(await statusOf(id)).toBe('pending');
      // The release dispatches wave 2: nobody new is in range, so the search carries on
      // (still searching), and v1 is never offered it again.
      expect((await offers(id)).filter((o) => o.vetId === v1.userId)).toHaveLength(1);
      // v2 still holds a wave-1 offer and can take the job.
      const theirs = (await offers(id)).find((o) => o.vetId === v2.userId);
      expect(
        (await h.post(`/v1/bookings/${id}/offers/${theirs?.id}/accept`, {}, v2.accessToken))
          .statusCode,
      ).toBe(200);
    });
  });

  describe('nobody available', () => {
    it('tells the farmer we are still searching, then cancels and credits the fee after 10 minutes', async () => {
      const id = await paidBooking();
      expect(await statusOf(id)).toBe('pending');
      expect(h.sms.filter((m) => m.phone === farmer.phone).at(-1)?.text).toMatch(
        /hakuna daktari aliyekubali ombi/,
      );
      h.advance(9 * MINUTE);
      await h.jobs.runDue();
      expect(await statusOf(id)).toBe('pending');
      h.advance(2 * MINUTE);
      await h.jobs.runDue();
      expect(await statusOf(id)).toBe('cancelled');
      const rows = await h.db.select().from(payments).where(eq(payments.bookingId, id));
      // Never refunded to M-Pesa: the fee becomes VetLink credit (§24.25).
      expect(rows.map((r) => [r.type, r.status])).toEqual([['deposit', 'success']]);
      const credit = await h.db.select().from(walletEntries).where(eq(walletEntries.bookingId, id));
      expect(credit.map((c) => [c.kind, c.amount])).toEqual([['credit_no_vet', 200]]);
      expect(h.sms.filter((m) => m.phone === farmer.phone).some((m) => /salio/.test(m.text))).toBe(
        true,
      );
      expect(h.jobs.failed).toEqual([]);
    });

    it('a vet who accepts before the deadline still gets the job', async () => {
      const id = await paidBooking();
      const late = await vetAt(1);
      // Support (or a later sweep) offers it to a vet who just came online.
      const { createOffer } = await import('../../src/modules/bookings/service.js');
      const offerId = await createOffer(h.ctx, {
        bookingId: id,
        vetId: late.userId,
        wave: 9,
        channel: 'push',
      });
      await h.post(`/v1/bookings/${id}/offers/${offerId}/accept`, {}, late.accessToken);
      h.advance(11 * MINUTE);
      await h.jobs.runDue();
      expect(await statusOf(id)).toBe('matched');
    });
  });

  describe('fee quote and availability', () => {
    it('quotes the median base fee of the best candidates', async () => {
      await vetAt(1, { fee: 300 });
      await vetAt(2, { fee: 900 });
      await vetAt(3, { fee: 600 });
      await vetAt(4, { fee: 5000 }); // 4th best: not in the quote
      const res = await h.post(
        '/v1/bookings',
        { species: 'cattle', problemType: 'sick' },
        farmer.accessToken,
        {
          'idempotency-key': `q-${randomUUID()}`,
        },
      );
      expect(res.json<FarmerBookingView>().feeQuoted).toBe(600);
    });

    it('only an approved vet can go online; anyone can go offline', async () => {
      const pending = await vetAt(1, {}, 'submitted');
      const off = await h.request('PATCH', '/v1/vets/me/availability', {
        token: pending.accessToken,
        body: { isAvailable: true },
      });
      expect(off.statusCode).toBe(403);
      expect(errorCode(off)).toBe('vet_not_approved');
      const approved = await vetAt(1, { online: false });
      const on = await h.request('PATCH', '/v1/vets/me/availability', {
        token: approved.accessToken,
        body: { isAvailable: true },
      });
      expect(on.json()).toMatchObject({ isAvailable: true, verificationStatus: 'approved' });
      const down = await h.request('PATCH', '/v1/vets/me/availability', {
        token: approved.accessToken,
        body: { isAvailable: false },
      });
      expect(down.json()).toMatchObject({ isAvailable: false });
    });
  });

  describe('admin config', () => {
    it('a super admin changes wave sizes (step-up, validated, audited); matching follows', async () => {
      const boss = await h.admin('super_admin');
      const url = '/v1/admin/config/matching.waveSizes';
      expect(
        errorCode(await h.request('PUT', url, { token: boss.accessToken, body: { value: [1] } })),
      ).toBe('step_up_required');
      await h.stepUp(boss);
      const bad = await h.request('PUT', '/v1/admin/config/matching.weights', {
        token: boss.accessToken,
        body: { value: { proximity: 1, specialty: 1, acceptance: 0, rating: 0, fairness: 0 } },
      });
      expect(errorCode(bad)).toBe('invalid_request');
      expect(
        (await h.request('PUT', url, { token: boss.accessToken, body: { value: [1] } })).statusCode,
      ).toBe(204);
      const list = (await h.get('/v1/admin/config', boss.accessToken)).json<
        { key: string; value: unknown; isDefault: boolean }[]
      >();
      expect(list.find((c) => c.key === 'matching.waveSizes')).toMatchObject({
        value: [1],
        isDefault: false,
      });

      const a = await vetAt(1);
      await vetAt(2);
      const id = await paidBooking();
      expect(await offeredTo(id, 1)).toEqual([a.userId]);
      const audits = await h.db
        .select()
        .from(auditLog)
        .where(
          and(eq(auditLog.action, 'config.changed'), eq(auditLog.entityId, 'matching.waveSizes')),
        );
      expect(audits).toHaveLength(1);
      // Put it back for the other tests sharing this database.
      await h.request('PUT', url, { token: boss.accessToken, body: { value: [3, 3, 5] } });
    });

    it('nobody else can read or change config', async () => {
      const support = await h.admin('support');
      expect((await h.get('/v1/admin/config', support.accessToken)).statusCode).toBe(404);
      expect((await h.get('/v1/admin/config', farmer.accessToken)).statusCode).toBe(404);
    });
  });
});
