import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FarmerBookingView, OfferView, VetJobView } from '@vetlink/shared';
import {
  animals,
  auditLog,
  bookingEvents,
  bookings,
  treatments,
  vets,
} from '../../src/db/schema/index.js';
import { DEFAULT_CALL_OUT_FEE_KES } from '../../src/modules/bookings/pricing.js';
import { createOffer } from '../../src/modules/bookings/service.js';
import { transition } from '../../src/modules/bookings/transitions.js';
import { Harness, errorCode, type Session } from '../helpers/harness.js';
import {
  createTestDatabase,
  DB_SETUP_TIMEOUT_MS,
  testServerUrl,
  type TestDatabase,
} from '../helpers/test-db.js';

describe.skipIf(!testServerUrl)('bookings (database)', { timeout: 30_000 }, () => {
  let tdb: TestDatabase;
  let h: Harness;
  let wardId: number;
  let keySeq = 0;

  beforeAll(async () => {
    tdb = await createTestDatabase();
  }, DB_SETUP_TIMEOUT_MS);
  afterAll(async () => {
    await tdb?.drop();
  }, DB_SETUP_TIMEOUT_MS);
  beforeEach(async () => {
    h = new Harness(tdb);
    wardId = await h.ward();
  });
  afterEach(async () => {
    await h.close();
  });

  const newKey = () => `test-key-${keySeq++}-abcdefgh`;
  const request = { species: 'cattle', problemType: 'sick', isEmergency: false };

  async function book(farmer: Session, body: object = request, key = newKey()) {
    return h.post('/v1/bookings', body, farmer.accessToken, { 'idempotency-key': key });
  }

  /** Payments arrive in M7; until then the deposit is confirmed the way the callback will. */
  async function confirmDeposit(bookingId: number) {
    await h.db.transaction((tx) =>
      transition(tx, bookingId, 'deposit_confirmed', { kind: 'system' }, h.now),
    );
  }

  async function pendingBookingWithOffers(farmer: Session, vetSessions: Session[]) {
    const res = await book(farmer);
    const booking = res.json<FarmerBookingView>();
    await confirmDeposit(booking.id);
    const offerIds: number[] = [];
    for (const v of vetSessions) {
      const offerId = await createOffer(h.ctx, {
        bookingId: booking.id,
        vetId: v.userId,
        wave: 1,
        channel: 'push',
      });
      offerIds.push(offerId ?? -1);
    }
    return { bookingId: booking.id, offerIds };
  }

  const accept = (vet: Session, bookingId: number, offerId: number) =>
    h.post(`/v1/bookings/${bookingId}/offers/${offerId}/accept`, {}, vet.accessToken);

  describe('creating a booking', () => {
    it('creates it in pending_payment with a server-quoted fee (client fee ignored)', async () => {
      const farmer = await h.farmer(wardId);
      const res = await book(farmer, { ...request, feeQuoted: 1, note: 'Not eating since Monday' });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({
        status: 'pending_payment',
        species: 'cattle',
        problemType: 'sick',
        feeQuoted: DEFAULT_CALL_OUT_FEE_KES,
        depositKes: 200,
        ward: { id: wardId },
        sourceChannel: 'web',
        vet: null,
        actions: ['farmer_cancelled'],
      });
    });

    it('records the client channel from X-VetLink-Channel', async () => {
      const farmer = await h.farmer(wardId);
      const res = await h.post('/v1/bookings', request, farmer.accessToken, {
        'idempotency-key': newKey(),
        'x-vetlink-channel': 'app',
      });
      expect(res.json()).toMatchObject({ sourceChannel: 'app' });
    });

    it('needs an Idempotency-Key, the farmer role, and a farmer profile', async () => {
      const farmer = await h.farmer(wardId);
      const noKey = await h.post('/v1/bookings', request, farmer.accessToken);
      expect(errorCode(noKey)).toBe('idempotency_key_required');

      const vet = await h.vet(wardId);
      expect((await book(vet)).statusCode).toBe(403);

      const noProfile = await h.login();
      await h.setRoles(noProfile.userId, ['farmer']);
      expect(errorCode(await book(noProfile))).toBe('farmer_profile_required');
    });

    it('a retry with the same key returns the same booking; a different body is refused', async () => {
      const farmer = await h.farmer(wardId);
      const key = newKey();
      const first = await book(farmer, request, key);
      const retry = await book(farmer, request, key);
      expect(retry.statusCode).toBe(200);
      expect(retry.json<FarmerBookingView>().id).toBe(first.json<FarmerBookingView>().id);
      const changed = await book(farmer, { ...request, species: 'goat' }, key);
      expect(changed.statusCode).toBe(422);
      expect(errorCode(changed)).toBe('idempotency_key_reused');
    });

    it('concurrent submissions with one key create exactly one booking', async () => {
      const farmer = await h.farmer(wardId);
      const key = newKey();
      const results = await Promise.all(
        Array.from({ length: 5 }, () => book(farmer, request, key)),
      );
      const ids = new Set(results.map((r) => r.json<FarmerBookingView>().id));
      expect(ids.size).toBe(1);
      expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    });

    it('keys are per farmer: the same key from two farmers makes two bookings', async () => {
      const a = await h.farmer(wardId);
      const b = await h.farmer(wardId);
      const key = newKey();
      const ra = await book(a, request, key);
      const rb = await book(b, request, key);
      expect(rb.statusCode).toBe(201);
      expect(rb.json<FarmerBookingView>().id).not.toBe(ra.json<FarmerBookingView>().id);
    });

    it("refuses another farmer's animal and an unknown ward", async () => {
      const a = await h.farmer(wardId);
      const b = await h.farmer(wardId);
      const [cow] = await h.db
        .insert(animals)
        .values({ farmerId: a.userId, species: 'cattle', nameOrTag: 'Daisy' })
        .returning({ id: animals.id });
      expect((await book(b, { ...request, animalId: cow?.id })).statusCode).toBe(404);
      expect((await book(a, { ...request, animalId: cow?.id })).statusCode).toBe(201);
      expect(errorCode(await book(a, { ...request, wardId: 999_999 }))).toBe('invalid_request');
    });
  });

  describe('the job, end to end', () => {
    it('deposit → offer → accept → on the way → arrived → complete → rate', async () => {
      const farmer = await h.farmer(wardId);
      const vet = await h.vet(wardId);
      const { bookingId, offerIds } = await pendingBookingWithOffers(farmer, [vet]);

      // The vet sees the offer without the farmer's identity.
      const offers = (await h.get('/v1/vets/me/offers', vet.accessToken)).json<OfferView[]>();
      expect(offers).toHaveLength(1);
      // Quoted from the base fee of the vet who would get it (600), not the client.
      expect(offers[0]).toMatchObject({ bookingId, species: 'cattle', feeQuoted: 600 });
      expect(JSON.stringify(offers)).not.toContain(farmer.phone);
      expect(Date.parse(offers[0]?.expiresAt ?? '') - Date.parse(offers[0]?.sentAt ?? '')).toBe(
        90_000,
      );

      const accepted = await accept(vet, bookingId, offerIds[0] ?? -1);
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json<VetJobView>()).toMatchObject({
        status: 'matched',
        farmer: { phone: farmer.phone, farmNotes: 'Blue gate' },
        actions: ['vet_released', 'vet_en_route', 'vet_completed'],
      });
      // The farmer now sees the vet, with phone, while the job is active.
      expect((await h.get(`/v1/bookings/${bookingId}`, farmer.accessToken)).json()).toMatchObject({
        status: 'matched',
        vet: { phone: vet.phone, type: 'vet' },
      });

      for (const status of ['en_route', 'in_service'] as const) {
        const res = await h.post(`/v1/bookings/${bookingId}/status`, { status }, vet.accessToken);
        expect(res.json()).toMatchObject({ status });
      }
      h.advance(10 * 60_000); // within the 15-minute access token
      const done = await h.post(
        `/v1/bookings/${bookingId}/complete`,
        {
          diagnosis: 'East Coast Fever',
          diagnosisCode: 'ecf',
          drugsUsed: 'Oxytetracycline 20ml',
          followUpDate: '2026-10-22',
        },
        vet.accessToken,
      );
      expect(done.json()).toMatchObject({ status: 'done', farmer: { phone: null } });

      const view = (
        await h.get(`/v1/bookings/${bookingId}`, farmer.accessToken)
      ).json<FarmerBookingView>();
      expect(view).toMatchObject({
        status: 'done',
        vet: { phone: null }, // contact hidden again after the job
        treatment: { diagnosis: 'East Coast Fever', followUpDate: '2026-10-22' },
        actions: [],
      });
      expect(view.timeline.map((t) => t.status)).toEqual([
        'pending',
        'matched',
        'en_route',
        'in_service',
        'done',
      ]);

      expect(
        (await h.post(`/v1/bookings/${bookingId}/rating`, { stars: 4 }, farmer.accessToken))
          .statusCode,
      ).toBe(204);
      const [vetRow] = await h.db.select().from(vets).where(eq(vets.userId, vet.userId));
      expect(vetRow?.rating).toBe('4.0');
      // A retry is fine; changing the rating is not.
      expect(
        (await h.post(`/v1/bookings/${bookingId}/rating`, { stars: 4 }, farmer.accessToken))
          .statusCode,
      ).toBe(204);
      expect(
        errorCode(
          await h.post(`/v1/bookings/${bookingId}/rating`, { stars: 1 }, farmer.accessToken),
        ),
      ).toBe('already_rated');
    });

    it('completion is exactly-once: a replayed completion writes no second treatment', async () => {
      const farmer = await h.farmer(wardId);
      const vet = await h.vet(wardId);
      const { bookingId, offerIds } = await pendingBookingWithOffers(farmer, [vet]);
      await accept(vet, bookingId, offerIds[0] ?? -1);
      const body = {
        notes: 'DONE ECF; oxytet 20ml; f/u 7d',
        clientCreatedAt: '2026-10-15T05:50:00Z',
      };
      const [a, b] = await Promise.all([
        h.post(`/v1/bookings/${bookingId}/complete`, body, vet.accessToken),
        h.post(`/v1/bookings/${bookingId}/complete`, body, vet.accessToken),
      ]);
      expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
      const rows = await h.db.select().from(treatments).where(eq(treatments.bookingId, bookingId));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.rawNotes).toBe(body.notes);
    });

    it('repeating a step is a no-op, and steps cannot be skipped backwards', async () => {
      const farmer = await h.farmer(wardId);
      const vet = await h.vet(wardId);
      const { bookingId, offerIds } = await pendingBookingWithOffers(farmer, [vet]);
      await accept(vet, bookingId, offerIds[0] ?? -1);
      const arrivedEarly = await h.post(
        `/v1/bookings/${bookingId}/status`,
        { status: 'in_service' },
        vet.accessToken,
      );
      expect(arrivedEarly.statusCode).toBe(409);
      expect(arrivedEarly.json()).toMatchObject({
        code: 'invalid_transition',
        details: { event: 'vet_arrived', status: 'matched' },
      });
      await h.post(`/v1/bookings/${bookingId}/status`, { status: 'en_route' }, vet.accessToken);
      const again = await h.post(
        `/v1/bookings/${bookingId}/status`,
        { status: 'en_route' },
        vet.accessToken,
      );
      expect(again.statusCode).toBe(200);
      const events = await h.db
        .select()
        .from(bookingEvents)
        .where(eq(bookingEvents.bookingId, bookingId));
      expect(events.filter((e) => e.event === 'vet_en_route')).toHaveLength(1);
    });
  });

  describe('accepting offers', () => {
    it('two vets accepting at once: exactly one wins, the other hears "job taken"', async () => {
      const farmer = await h.farmer(wardId);
      const v1 = await h.vet(wardId);
      const v2 = await h.vet(wardId);
      const { bookingId, offerIds } = await pendingBookingWithOffers(farmer, [v1, v2]);
      const [r1, r2] = await Promise.all([
        accept(v1, bookingId, offerIds[0] ?? -1),
        accept(v2, bookingId, offerIds[1] ?? -1),
      ]);
      const statuses = [r1.statusCode, r2.statusCode].sort();
      expect(statuses).toEqual([200, 409]);
      const loser = r1.statusCode === 409 ? r1 : r2;
      expect(errorCode(loser)).toBe('offer_taken');
      const winner = r1.statusCode === 200 ? v1 : v2;
      const [row] = await h.db.select().from(bookings).where(eq(bookings.id, bookingId));
      expect(row?.vetId).toBe(winner.userId);
      const events = await h.db
        .select()
        .from(bookingEvents)
        .where(eq(bookingEvents.bookingId, bookingId));
      expect(events.filter((e) => e.event === 'vet_accepted')).toHaveLength(1);
    });

    it('an unapproved vet can never accept, even holding an offer (invariant 2)', async () => {
      const farmer = await h.farmer(wardId);
      const pending = await h.vet(wardId, 'submitted');
      const { bookingId, offerIds } = await pendingBookingWithOffers(farmer, [pending]);
      const res = await accept(pending, bookingId, offerIds[0] ?? -1);
      expect(res.statusCode).toBe(403);
      expect(errorCode(res)).toBe('vet_not_approved');
      // Suspended after the offer went out: same answer.
      const vet = await h.vet(wardId);
      const second = await pendingBookingWithOffers(farmer, [vet]);
      await h.db
        .update(vets)
        .set({ verificationStatus: 'suspended', isAvailable: false })
        .where(eq(vets.userId, vet.userId));
      expect(errorCode(await accept(vet, second.bookingId, second.offerIds[0] ?? -1))).toBe(
        'vet_not_approved',
      );
    });

    it("a vet cannot accept without an offer or with someone else's offer", async () => {
      const farmer = await h.farmer(wardId);
      const v1 = await h.vet(wardId);
      const v2 = await h.vet(wardId);
      const { bookingId, offerIds } = await pendingBookingWithOffers(farmer, [v1]);
      expect((await accept(v2, bookingId, offerIds[0] ?? -1)).statusCode).toBe(404);
    });

    it('decline is idempotent; a declined offer cannot then be accepted', async () => {
      const farmer = await h.farmer(wardId);
      const vet = await h.vet(wardId);
      const { bookingId, offerIds } = await pendingBookingWithOffers(farmer, [vet]);
      const url = `/v1/bookings/${bookingId}/offers/${offerIds[0]}/decline`;
      expect((await h.post(url, {}, vet.accessToken)).statusCode).toBe(204);
      expect((await h.post(url, {}, vet.accessToken)).statusCode).toBe(204);
      expect(errorCode(await accept(vet, bookingId, offerIds[0] ?? -1))).toBe('invalid_transition');
      expect((await h.get('/v1/vets/me/offers', vet.accessToken)).json()).toEqual([]);
    });

    it('a vet who releases the job sends it back to searching for another vet', async () => {
      const farmer = await h.farmer(wardId);
      const v1 = await h.vet(wardId);
      const v2 = await h.vet(wardId);
      const { bookingId, offerIds } = await pendingBookingWithOffers(farmer, [v1, v2]);
      await accept(v1, bookingId, offerIds[0] ?? -1);
      expect(
        (await h.post(`/v1/bookings/${bookingId}/release`, {}, v1.accessToken)).statusCode,
      ).toBe(204);
      expect((await h.get(`/v1/bookings/${bookingId}`, v1.accessToken)).statusCode).toBe(404);
      expect((await accept(v2, bookingId, offerIds[1] ?? -1)).statusCode).toBe(200);
    });
  });

  describe('cancelling', () => {
    it('the farmer can cancel until the vet is with the animal; then the offer is taken', async () => {
      const farmer = await h.farmer(wardId);
      const vet = await h.vet(wardId);
      const { bookingId, offerIds } = await pendingBookingWithOffers(farmer, [vet]);
      const res = await h.post(
        `/v1/bookings/${bookingId}/cancel`,
        { reason: 'animal_recovered' },
        farmer.accessToken,
      );
      expect(res.json()).toMatchObject({ status: 'cancelled', actions: [] });
      expect(errorCode(await accept(vet, bookingId, offerIds[0] ?? -1))).toBe('offer_taken');
      const [event] = await h.db
        .select()
        .from(bookingEvents)
        .where(eq(bookingEvents.bookingId, bookingId))
        .orderBy(bookingEvents.id);
      expect(event).toBeDefined();
    });

    it('cannot cancel once in service', async () => {
      const farmer = await h.farmer(wardId);
      const vet = await h.vet(wardId);
      const { bookingId, offerIds } = await pendingBookingWithOffers(farmer, [vet]);
      await accept(vet, bookingId, offerIds[0] ?? -1);
      await h.post(`/v1/bookings/${bookingId}/status`, { status: 'en_route' }, vet.accessToken);
      await h.post(`/v1/bookings/${bookingId}/status`, { status: 'in_service' }, vet.accessToken);
      const res = await h.post(
        `/v1/bookings/${bookingId}/cancel`,
        { reason: 'changed_mind' },
        farmer.accessToken,
      );
      expect(errorCode(res)).toBe('invalid_transition');
    });

    it('rejects free-text reasons (only the fixed list)', async () => {
      const farmer = await h.farmer(wardId);
      const id = (await book(farmer)).json<FarmerBookingView>().id;
      const res = await h.post(
        `/v1/bookings/${id}/cancel`,
        { reason: 'call me on 0712345678' },
        farmer.accessToken,
      );
      expect(errorCode(res)).toBe('invalid_request');
    });
  });

  describe('who can see what', () => {
    it("farmers and vets only see their own bookings; others get 'not found'", async () => {
      const a = await h.farmer(wardId);
      const b = await h.farmer(wardId);
      const vet = await h.vet(wardId);
      const other = await h.vet(wardId);
      const { bookingId, offerIds } = await pendingBookingWithOffers(a, [vet]);
      expect((await h.get(`/v1/bookings/${bookingId}`, b.accessToken)).statusCode).toBe(404);
      expect(
        (await h.post(`/v1/bookings/${bookingId}/cancel`, { reason: 'other' }, b.accessToken))
          .statusCode,
      ).toBe(404);
      // An offered vet sees the offer, not the booking, until they accept.
      expect((await h.get(`/v1/bookings/${bookingId}`, vet.accessToken)).statusCode).toBe(404);
      await accept(vet, bookingId, offerIds[0] ?? -1);
      expect((await h.get(`/v1/bookings/${bookingId}`, vet.accessToken)).statusCode).toBe(200);
      expect((await h.get(`/v1/bookings/${bookingId}`, other.accessToken)).statusCode).toBe(404);
      expect(
        (
          await h.post(
            `/v1/bookings/${bookingId}/status`,
            { status: 'en_route' },
            other.accessToken,
          )
        ).statusCode,
      ).toBe(404);
    });

    it('lists only my bookings; a farmer-and-vet user picks a list with ?as', async () => {
      const farmer = await h.farmer(wardId);
      await book(farmer);
      await book(farmer);
      const mine = (await h.get('/v1/bookings', farmer.accessToken)).json<FarmerBookingView[]>();
      expect(mine).toHaveLength(2);
      expect(mine[0]?.id ?? 0).toBeGreaterThan(mine[1]?.id ?? 0); // newest first
      const page = (
        await h.get(`/v1/bookings?limit=1&before=${mine[0]?.id}`, farmer.accessToken)
      ).json<FarmerBookingView[]>();
      expect(page.map((b) => b.id)).toEqual([mine[1]?.id]);
      expect((await h.get('/v1/bookings?as=vet', farmer.accessToken)).statusCode).toBe(403);
    });
  });

  describe('admin', () => {
    it('support lists bookings, sees offers, and cancels with step-up (audited)', async () => {
      const farmer = await h.farmer(wardId);
      const vet = await h.vet(wardId);
      const { bookingId } = await pendingBookingWithOffers(farmer, [vet]);
      const support = await h.admin('support');
      const list = await h.get('/v1/admin/bookings?status=pending', support.accessToken);
      expect(list.json<FarmerBookingView[]>().map((b) => b.id)).toContain(bookingId);
      const detail = await h.get(`/v1/admin/bookings/${bookingId}`, support.accessToken);
      expect(detail.json()).toMatchObject({
        id: bookingId,
        farmer: { phone: farmer.phone },
        offers: [{ vetId: vet.userId, wave: 1, response: null }],
      });

      const url = `/v1/admin/bookings/${bookingId}/cancel`;
      expect(
        errorCode(await h.post(url, { reason: 'Duplicate request' }, support.accessToken)),
      ).toBe('step_up_required');
      await h.stepUp(support);
      const res = await h.post(url, { reason: 'Duplicate request' }, support.accessToken);
      expect(res.json()).toMatchObject({ status: 'cancelled' });
      const audits = await h.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.entityId, String(bookingId)));
      expect(audits.map((a) => a.action)).toContain('booking.cancelled');
    });

    it('other admin permissions and non-admins cannot reach booking admin', async () => {
      const verifier = await h.admin('verifier');
      expect((await h.get('/v1/admin/bookings', verifier.accessToken)).statusCode).toBe(404);
      const farmer = await h.farmer(wardId);
      expect((await h.get('/v1/admin/bookings', farmer.accessToken)).statusCode).toBe(404);
    });
  });

  it('system-only events cannot be triggered by a farmer through the service', async () => {
    const farmer = await h.farmer(wardId);
    const id = (await book(farmer)).json<FarmerBookingView>().id;
    await expect(
      h.db.transaction((tx) =>
        transition(
          tx,
          id,
          'deposit_confirmed',
          { kind: 'farmer', userId: farmer.userId, channel: 'web' },
          h.now,
        ),
      ),
    ).rejects.toMatchObject({ code: 'invalid_transition' });
  });
});
