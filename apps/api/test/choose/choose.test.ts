import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FarmerBookingView, OfferView, VetJobView } from '@vetlink/shared';
import {
  bookingOffers,
  bookings,
  notifications,
  payments,
  vets,
} from '../../src/db/schema/index.js';
import { sweepDeadlines } from '../../src/modules/bookings/choose.js';
import { handleStkResult } from '../../src/modules/payments/service.js';
import { Harness, errorCode, type Session } from '../helpers/harness.js';
import {
  createTestDatabase,
  DB_SETUP_TIMEOUT_MS,
  testServerUrl,
  type TestDatabase,
} from '../helpers/test-db.js';

const MIN = 60_000;

describe.skipIf(!testServerUrl)('farmer chooses the vet (database)', { timeout: 60_000 }, () => {
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
    h = new Harness(tdb, {
      webhookSecret: 'choose-webhook-secret-0123456789ab',
      echoSmsReplies: true,
    });
    wardId = await h.ward();
  });
  afterEach(async () => {
    await h.close();
  });

  const request = { species: 'cattle', problemType: 'sick' };
  const book = (farmer: Session, body: object) =>
    h.post('/v1/bookings', { ...request, ...body }, farmer.accessToken, {
      'idempotency-key': `c-${randomUUID()}`,
    });
  const choose = (farmer: Session, vet: Session) =>
    book(farmer, { dispatchMode: 'chosen', vetId: vet.userId });
  const view = async (farmer: Session, id: number) =>
    (await h.get(`/v1/bookings/${id}`, farmer.accessToken)).json<FarmerBookingView>();
  const offersOf = async (vet: Session) =>
    (await h.get('/v1/vets/me/offers', vet.accessToken)).json<OfferView[]>();
  const kinds = async (userId: string) =>
    (await h.db.select().from(notifications).where(eq(notifications.userId, userId))).map(
      (n) => n.kind,
    );
  const sweep = () => sweepDeadlines(h.ctx, h.app.log);

  /** M-Pesa says yes to the booking's pending STK push (callback confirmed by a query). */
  async function pay(bookingId: number) {
    const [p] = await h.db
      .select()
      .from(payments)
      .where(and(eq(payments.bookingId, bookingId), eq(payments.status, 'pending')));
    const cid = p?.checkoutRequestId ?? '';
    const result = {
      checkoutRequestId: cid,
      resultCode: 0,
      resultDesc: 'ok',
      receipt: `R${bookingId}`,
      amount: p?.amount,
    };
    h.gateway.outcomes.set(cid, result);
    await handleStkResult(h.ctx, result, 'callback', h.app.log);
  }

  describe('the list', () => {
    it('shows choosable vets with their price, rounded distance, and nothing private', async () => {
      const farmer = await h.farmer(wardId);
      const cheap = await h.vet(wardId, 'approved', { consultationFee: 300 });
      const dear = await h.vet(wardId, 'approved', { consultationFee: 900 });
      await h.vet(wardId, 'approved', { online: false }); // offline
      await h.vet(wardId, 'approved', { offersCallOuts: false }); // clinic only
      await h.vet(wardId, 'submitted'); // not approved (invariant 2)
      await h.db
        .update(vets)
        .set({ shareLiveLocation: true, liveLat: 1, liveLng: 1, liveLocationAt: h.now })
        .where(eq(vets.userId, cheap.userId));

      const res = await h.get('/v1/vets/choose?species=cattle&sort=price', farmer.accessToken);
      const list = res.json<{ vetId: string; distanceKm: number; price: { total: number } }[]>();
      expect(list.map((v) => v.vetId)).toEqual([cheap.userId, dear.userId]);
      expect(list[0]?.price.total).toBe(900); // 300 + call-out 600
      // Live location is never used for the list (it would put this vet far away).
      expect(list[0]?.distanceKm).toBe(0);
      const raw = JSON.stringify(list);
      for (const secret of [cheap.phone, '"lat"', 'liveLat', 'nationalId']) {
        expect(raw).not.toContain(secret);
      }
      const vet = await h.vet(wardId);
      expect(errorCode(await h.get('/v1/vets/choose?species=cattle', vet.accessToken))).toBe(
        'forbidden',
      );
    });

    it('a farmer-facing vet card shows only public fields; unapproved vets are not found', async () => {
      const farmer = await h.farmer(wardId);
      const vet = await h.vet(wardId);
      const pending = await h.vet(wardId, 'submitted');
      const card = await h.get(`/v1/vets/${vet.userId}/card`, farmer.accessToken);
      expect(card.json()).toMatchObject({
        vetId: vet.userId,
        consultationFee: 500,
        callOutFee: 600,
      });
      expect(JSON.stringify(card.json())).not.toContain(vet.phone);
      expect(errorCode(await h.get(`/v1/vets/${pending.userId}/card`, farmer.accessToken))).toBe(
        'not_found',
      );
    });
  });

  describe('request, accept, pay', () => {
    it('only the chosen vet is asked; the booking fee is asked for when they accept', async () => {
      const farmer = await h.farmer(wardId);
      const vet = await h.vet(wardId);
      const other = await h.vet(wardId);

      const res = await choose(farmer, vet);
      expect(res.statusCode).toBe(201);
      const booking = res.json<FarmerBookingView>();
      expect(booking).toMatchObject({
        status: 'requested',
        dispatchMode: 'chosen',
        requestedVet: { id: vet.userId },
        vet: null,
      });
      expect(Date.parse(booking.statusDeadlineAt ?? '') - h.now.getTime()).toBe(5 * MIN);
      expect(h.gateway.pushes).toHaveLength(0); // nothing to pay yet
      expect(await offersOf(other)).toEqual([]);
      const [offer] = await offersOf(vet);
      expect(offer).toMatchObject({ bookingId: booking.id, kind: 'direct' });
      expect(offer?.expiresAt).toBe(booking.statusDeadlineAt);
      expect(await kinds(vet.userId)).toContain('request');

      const accepted = await h.post(
        `/v1/bookings/${booking.id}/offers/${offer?.offerId}/accept`,
        {},
        vet.accessToken,
      );
      expect(accepted.json<VetJobView>()).toMatchObject({
        status: 'awaiting_deposit',
        farmer: { phone: null }, // no contact before the fee is paid
      });
      expect(h.gateway.pushes.map((p) => p.amount)).toEqual([200]);
      expect(await kinds(farmer.userId)).toContain('vet_accepted_pay');
      const waiting = await view(farmer, booking.id);
      expect(waiting).toMatchObject({ status: 'awaiting_deposit', vet: { phone: null } });
      expect(Date.parse(waiting.statusDeadlineAt ?? '') - h.now.getTime()).toBe(5 * MIN);

      await pay(booking.id);
      const matched = await view(farmer, booking.id);
      expect(matched).toMatchObject({
        status: 'matched',
        statusDeadlineAt: null,
        vet: { phone: vet.phone },
        price: { total: 1100, payVet: 900 },
      });
      expect(await kinds(vet.userId)).toContain('request_confirmed');
    });

    it('declined: the farmer chooses again (declined vets hidden) or switches to fastest', async () => {
      const farmer = await h.farmer(wardId);
      const first = await h.vet(wardId);
      const second = await h.vet(wardId);
      const booking = (await choose(farmer, first)).json<FarmerBookingView>();
      const [offer] = await offersOf(first);
      await h.post(
        `/v1/bookings/${booking.id}/offers/${offer?.offerId}/decline`,
        {},
        first.accessToken,
      );
      expect((await view(farmer, booking.id)).status).toBe('vet_unavailable');
      expect(await kinds(farmer.userId)).toContain('request_declined');

      const again = (await h.get(`/v1/bookings/${booking.id}/vets`, farmer.accessToken)).json<
        { vetId: string }[]
      >();
      expect(again.map((v) => v.vetId)).toEqual([second.userId]);
      const rechoose = (vetId: string) =>
        h.post(`/v1/bookings/${booking.id}/rechoose`, { vetId }, farmer.accessToken);
      expect(errorCode(await rechoose(first.userId))).toBe('vet_unavailable_now');
      const res = await rechoose(second.userId);
      expect(res.json<FarmerBookingView>()).toMatchObject({
        status: 'requested',
        requestedVet: { id: second.userId },
        directChoices: 2,
      });
      expect(await offersOf(second)).toHaveLength(1);

      // The second vet does not answer in 5 minutes: the farmer goes to fastest available.
      h.advance(5 * MIN);
      expect(await sweep()).toBe(1);
      expect((await view(farmer, booking.id)).status).toBe('vet_unavailable');
      const offers = await h.db
        .select()
        .from(bookingOffers)
        .where(eq(bookingOffers.bookingId, booking.id));
      expect(offers.map((o) => o.response).sort()).toEqual(['declined', 'timeout']);
      const auto = await h.post(
        `/v1/bookings/${booking.id}/switch-to-auto`,
        {},
        farmer.accessToken,
      );
      expect(auto.json<FarmerBookingView>()).toMatchObject({
        status: 'pending_payment',
        dispatchMode: 'auto',
        statusDeadlineAt: null,
      });
    });

    it('nobody chooses again in 10 minutes: the booking expires; nothing was paid', async () => {
      const farmer = await h.farmer(wardId);
      const vet = await h.vet(wardId);
      const booking = (await choose(farmer, vet)).json<FarmerBookingView>();
      h.advance(5 * MIN);
      await sweep();
      h.advance(9 * MIN);
      await sweep();
      expect((await view(farmer, booking.id)).status).toBe('vet_unavailable');
      h.advance(1 * MIN);
      await sweep();
      // (Read from the database: 15 simulated minutes outlive the access token.)
      const [row] = await h.db.select().from(bookings).where(eq(bookings.id, booking.id));
      expect(row?.status).toBe('expired');
      expect(h.gateway.pushes).toHaveLength(0);
    });

    it('the fee is not paid in 5 minutes: expired, the vet is told; a late payment is refunded', async () => {
      const farmer = await h.farmer(wardId);
      const vet = await h.vet(wardId);
      const booking = (await choose(farmer, vet)).json<FarmerBookingView>();
      const [offer] = await offersOf(vet);
      await h.post(
        `/v1/bookings/${booking.id}/offers/${offer?.offerId}/accept`,
        {},
        vet.accessToken,
      );
      h.advance(5 * MIN);
      await sweep();
      expect((await view(farmer, booking.id)).status).toBe('expired');
      expect(await kinds(vet.userId)).toContain('request_unpaid');
      // The vet is free again.
      const next = await h.farmer(wardId);
      expect((await choose(next, vet)).statusCode).toBe(201);

      await pay(booking.id); // M-Pesa result arrives after all
      const rows = await h.db.select().from(payments).where(eq(payments.bookingId, booking.id));
      expect(rows.map((p) => p.type).sort()).toEqual(['deposit', 'refund']);
    });
  });

  describe('races and gating', () => {
    it('a vet who went offline cannot be chosen; emergencies cannot choose', async () => {
      const farmer = await h.farmer(wardId);
      const vet = await h.vet(wardId);
      await h.request('PATCH', '/v1/vets/me/availability', {
        token: vet.accessToken,
        body: { isAvailable: false },
      });
      expect(errorCode(await choose(farmer, vet))).toBe('vet_unavailable_now');
      const online = await h.vet(wardId);
      expect(
        errorCode(
          await book(farmer, { dispatchMode: 'chosen', vetId: online.userId, isEmergency: true }),
        ),
      ).toBe('invalid_request');
      const suspended = await h.vet(wardId, 'suspended', { online: false });
      expect(errorCode(await choose(farmer, suspended))).toBe('vet_unavailable_now');
    });

    it('two farmers choose the same vet: the vet can hold only one waiting job', async () => {
      const a = await h.farmer(wardId);
      const b = await h.farmer(wardId);
      const vet = await h.vet(wardId);
      const ba = (await choose(a, vet)).json<FarmerBookingView>();
      const bb = (await choose(b, vet)).json<FarmerBookingView>();
      const offers = await offersOf(vet);
      expect(offers).toHaveLength(2);
      const accept = (bookingId: number) =>
        h.post(
          `/v1/bookings/${bookingId}/offers/${offers.find((o) => o.bookingId === bookingId)?.offerId}/accept`,
          {},
          vet.accessToken,
        );
      expect((await accept(ba.id)).statusCode).toBe(200);
      expect(errorCode(await accept(bb.id))).toBe('at_capacity');
      // While held, the vet is not in anyone's list.
      const c = await h.farmer(wardId);
      expect(
        (await h.get('/v1/vets/choose?species=cattle', c.accessToken)).json<unknown[]>(),
      ).toEqual([]);
    });

    it('the clock wins over a late accept: once timed out, the request cannot be accepted', async () => {
      const farmer = await h.farmer(wardId);
      const vet = await h.vet(wardId);
      const booking = (await choose(farmer, vet)).json<FarmerBookingView>();
      const [offer] = await offersOf(vet);
      h.advance(5 * MIN);
      await sweep();
      expect(
        errorCode(
          await h.post(
            `/v1/bookings/${booking.id}/offers/${offer?.offerId}/accept`,
            {},
            vet.accessToken,
          ),
        ),
      ).toBe('offer_taken');
    });

    it('SMS: Y accepts a direct request and says the farmer is paying first', async () => {
      const farmer = await h.farmer(wardId);
      const vet = await h.vet(wardId);
      const booking = (await choose(farmer, vet)).json<FarmerBookingView>();
      const res = await h.app.inject({
        method: 'POST',
        url: '/webhooks/sms?token=choose-webhook-secret-0123456789ab',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({
          from: `+${vet.phone}`,
          text: `Y${booking.id}`,
          id: randomUUID(),
          to: '20880',
        }).toString(),
      });
      expect(res.json<{ reply: string }>().reply).not.toContain(farmer.phone);
      const [row] = await h.db.select().from(bookings).where(eq(bookings.id, booking.id));
      expect(row?.status).toBe('awaiting_deposit');
    });

    it('a chosen vet who hands back a paid job: the booking goes to fastest available', async () => {
      const farmer = await h.farmer(wardId);
      const vet = await h.vet(wardId);
      const booking = (await choose(farmer, vet)).json<FarmerBookingView>();
      const [offer] = await offersOf(vet);
      await h.post(
        `/v1/bookings/${booking.id}/offers/${offer?.offerId}/accept`,
        {},
        vet.accessToken,
      );
      await pay(booking.id);
      const released = await h.post(`/v1/bookings/${booking.id}/release`, {}, vet.accessToken);
      expect(released.statusCode).toBeLessThan(300);
      expect(await view(farmer, booking.id)).toMatchObject({
        status: 'pending',
        dispatchMode: 'auto',
        price: null,
      });
    });
  });
});
