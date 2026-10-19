import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { messages } from '@vetlink/i18n';
import type { FarmerBookingView, OfferView, VetJobView } from '@vetlink/shared';
import { auditLog, vetDocuments, vets } from '../../src/db/schema/index.js';
import { fieldContext } from '../../src/lib/crypto.js';
import { createOffer } from '../../src/modules/bookings/service.js';
import { transition } from '../../src/modules/bookings/transitions.js';
import { Harness, errorCode, type Session } from '../helpers/harness.js';
import {
  createTestDatabase,
  DB_SETUP_TIMEOUT_MS,
  testServerUrl,
  type TestDatabase,
} from '../helpers/test-db.js';

interface VetProfile {
  consultationFee: number | null;
  serviceFees: Record<string, number>;
  offersCallOuts: boolean;
  hasPremises: boolean;
  practiceMissing: string[];
  qualifications: { nationalIdLast3: string | null };
  documents: { id: number; kind: string }[];
}

const SECRET = 'pricing-webhook-secret-0123456789ab';

describe.skipIf(!testServerUrl)('prices and practice (database)', { timeout: 60_000 }, () => {
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
    h = new Harness(tdb, { webhookSecret: SECRET, echoSmsReplies: true });
    wardId = await h.ward();
  });
  afterEach(async () => {
    await h.close();
  });

  const patch = (s: Session, body: object) =>
    h.request('PATCH', '/v1/vets/me/profile', { token: s.accessToken, body });
  const book = (farmer: Session, body: object) =>
    h.post(
      '/v1/bookings',
      { species: 'cattle', problemType: 'sick', ...body },
      farmer.accessToken,
      { 'idempotency-key': `p-${randomUUID()}` },
    );

  describe('a vet sets prices', () => {
    it('edits apply at once within the admin bands; every offered service needs a price', async () => {
      const vet = await h.vet(wardId); // consultation 500, treatment 300, vaccination 200
      expect(errorCode(await patch(vet, { consultationFee: 100 }))).toBe('invalid_request'); // < booking fee
      expect(errorCode(await patch(vet, { consultationFee: 9000 }))).toBe('invalid_request');
      expect(errorCode(await patch(vet, { serviceFees: { deworming: 99_999 } }))).toBe(
        'invalid_request',
      );
      const missing = await patch(vet, { services: ['treatment', 'vaccination', 'deworming'] });
      expect(missing.json<{ details: { fields: string[] } }>().details.fields).toEqual([
        'serviceFees.deworming',
      ]);
      expect(errorCode(await patch(vet, { offersCallOuts: false, hasPremises: false }))).toBe(
        'invalid_request',
      );
      expect(errorCode(await patch(vet, { hasPremises: true }))).toBe('invalid_request'); // no ward

      const ok = await patch(vet, {
        consultationFee: 700,
        services: ['treatment', 'deworming'],
        serviceFees: { deworming: 150 },
        hasPremises: true,
        premisesWardId: wardId,
        premisesDirections: 'Behind the dairy',
        workingHours: {
          mon: [
            { from: '08:00', to: '12:00' },
            { from: '14:00', to: '18:00' },
          ],
        },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json<VetProfile>()).toMatchObject({
        consultationFee: 700,
        // Vaccination is no longer offered, so its price is dropped.
        serviceFees: { treatment: 300, deworming: 150 },
        hasPremises: true,
        practiceMissing: [],
      });
      expect(
        errorCode(await patch(vet, { workingHours: { mon: [{ from: '12:00', to: '09:00' }] } })),
      ).toBe('invalid_request');
    });

    it('a vet without a consultation fee cannot go online, in the app or by SMS', async () => {
      const vet = await h.vet(wardId, 'approved', { consultationFee: null, online: false });
      expect(
        errorCode(
          await h.request('PATCH', '/v1/vets/me/availability', {
            token: vet.accessToken,
            body: { isAvailable: true },
          }),
        ),
      ).toBe('practice_incomplete');
      const res = await h.app.inject({
        method: 'POST',
        url: `/webhooks/sms?token=${SECRET}`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({
          from: `+${vet.phone}`,
          text: 'ON',
          id: randomUUID(),
          to: '20880',
        }).toString(),
      });
      expect(res.json<{ reply: string }>().reply).toBe(messages.sw.sms.practiceIncomplete);
      const me = (await h.get('/v1/vets/me', vet.accessToken)).json<VetProfile>();
      expect(me.practiceMissing).toContain('consultationFee');
    });

    it('the profile shows qualifications and documents; only the owner opens them, logged', async () => {
      const vet = await h.vet(wardId);
      const other = await h.vet(wardId);
      await h.db
        .update(vets)
        .set({
          nationalIdEnc: h.ctx.crypto.encrypt(
            '12345678',
            fieldContext('vets.national_id', vet.userId),
          ),
        })
        .where(eq(vets.userId, vet.userId));
      const app = (await h.get('/v1/vets/me/application', vet.accessToken)).json<{ id: number }>();
      const [doc] = await h.db
        .insert(vetDocuments)
        .values({
          applicationId: app.id,
          vetUserId: vet.userId,
          kind: 'licence',
          storageKey: `vet-documents/${vet.userId}/${app.id}/licence-x.jpg`,
        })
        .returning();
      const me = (await h.get('/v1/vets/me', vet.accessToken)).json<VetProfile>();
      expect(me.qualifications.nationalIdLast3).toBe('678');
      expect(JSON.stringify(me)).not.toContain('12345678');
      expect(me.documents.map((d) => d.kind)).toEqual(['licence']);

      const url = `/v1/vets/me/documents/${doc?.id}/url`;
      expect(errorCode(await h.get(url, other.accessToken))).toBe('not_found');
      expect((await h.get(url, vet.accessToken)).statusCode).toBe(200);
      const logged = await h.db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, 'vet_document.viewed_by_owner'),
            eq(auditLog.actorUserId, vet.userId),
          ),
        );
      expect(logged).toHaveLength(1);
    });
  });

  describe('what the farmer sees and pays', () => {
    it('quotes a range from nearby vets who offer the added services', async () => {
      const farmer = await h.farmer(wardId);
      // Totals: consultation + services + call-out (600 by default).
      await h.vet(wardId, 'approved', { consultationFee: 400 }); // vaccination 200 → 1200
      await h.vet(wardId, 'approved', {
        consultationFee: 900,
        serviceFees: { treatment: 300, vaccination: 500 },
      }); // → 2000
      await h.vet(wardId, 'approved', { serviceFees: { treatment: 300 } }); // no vaccination
      await h.vet(wardId, 'approved', { offersCallOuts: false }); // premises only: never listed

      const quote = (services: string) =>
        h.get(`/v1/bookings/quote?species=cattle&services=${services}`, farmer.accessToken);
      expect((await quote('vaccination')).json()).toMatchObject({
        depositKes: 200,
        priceRange: { min: 1200, max: 2000, bookingFee: 200, vets: 2 },
      });
      // Consultation only ("other"): three vets do call-outs.
      expect((await quote('')).json()).toMatchObject({
        priceRange: { min: 1000, max: 1500, vets: 3 },
      });
      expect((await quote('surgery')).statusCode).toBe(400);
    });

    it("the accepting vet's price is fixed at acceptance; the farmer pays the vet the rest", async () => {
      const farmer = await h.farmer(wardId);
      const vet = await h.vet(wardId);
      const res = await book(farmer, {
        services: ['vaccination'],
        problemType: 'vaccination',
        priceRange: { min: 1, max: 1 }, // ignored: prices come from the server
      });
      const booking = res.json<FarmerBookingView>();
      expect(booking).toMatchObject({
        services: ['vaccination'],
        priceRange: { min: 1300, max: 1300 },
        price: null,
      });
      await h.db.transaction((tx) =>
        transition(tx, booking.id, 'deposit_confirmed', { kind: 'system' }, h.now),
      );
      const offerId = await createOffer(h.ctx, {
        bookingId: booking.id,
        vetId: vet.userId,
        wave: 1,
        channel: 'push',
      });
      const expected = {
        consultation: 500,
        services: [{ service: 'vaccination', fee: 200 }],
        callOut: 600,
        total: 1300,
        bookingFee: 200,
        payVet: 1100,
      };
      const offers = (await h.get('/v1/vets/me/offers', vet.accessToken)).json<OfferView[]>();
      expect(offers[0]?.price).toEqual(expected);

      const accepted = await h.post(
        `/v1/bookings/${booking.id}/offers/${offerId}/accept`,
        {},
        vet.accessToken,
      );
      expect(accepted.json<VetJobView>().price).toEqual(expected);
      // A later price change does not touch an accepted job.
      await patch(vet, { serviceFees: { vaccination: 900 } });
      const seen = (
        await h.get(`/v1/bookings/${booking.id}`, farmer.accessToken)
      ).json<FarmerBookingView>();
      expect(seen.price).toEqual(expected);
    });

    it('matching skips vets who do not offer an added service', async () => {
      const farmer = await h.farmer(wardId);
      const withAi = await h.vet(wardId, 'approved', {
        serviceFees: { treatment: 300, artificial_insemination: 1500 },
      });
      await h.db
        .update(vets)
        .set({ services: ['treatment', 'artificial_insemination'] })
        .where(eq(vets.userId, withAi.userId));
      await h.vet(wardId); // treatment and vaccination only
      const quote = await h.get(
        '/v1/bookings/quote?species=cattle&services=artificial_insemination',
        farmer.accessToken,
      );
      expect(quote.json()).toMatchObject({ priceRange: { vets: 1, min: 2600 } });
    });

    it('an admin changes the booking fee; existing bookings keep theirs, the STK push charges it', async () => {
      const farmer = await h.farmer(wardId);
      await h.vet(wardId);
      const before = (await book(farmer, {})).json<FarmerBookingView>();
      const boss = await h.admin('super_admin');
      await h.stepUp(boss);
      expect(
        (
          await h.request('PUT', '/v1/admin/config/payments.bookingFeeKes', {
            token: boss.accessToken,
            body: { value: 300 },
          })
        ).statusCode,
      ).toBe(204);
      const after = (await book(farmer, {})).json<FarmerBookingView>();
      expect(before.depositKes).toBe(200);
      expect(after.depositKes).toBe(300);
      expect(after.priceRange).toMatchObject({ bookingFee: 300 });

      await h.post('/v1/payments/stk', { bookingId: after.id }, farmer.accessToken);
      await h.post('/v1/payments/stk', { bookingId: before.id }, farmer.accessToken);
      expect(h.gateway.pushes.map((p) => p.amount)).toEqual([300, 200]);
    });

    it('the same idempotency key with different services is refused', async () => {
      const farmer = await h.farmer(wardId);
      const key = { 'idempotency-key': `p-${randomUUID()}` };
      const body = { species: 'cattle', problemType: 'sick' };
      expect(
        (
          await h.post(
            '/v1/bookings',
            { ...body, services: ['treatment'] },
            farmer.accessToken,
            key,
          )
        ).statusCode,
      ).toBe(201);
      expect(
        errorCode(
          await h.post(
            '/v1/bookings',
            { ...body, services: ['deworming'] },
            farmer.accessToken,
            key,
          ),
        ),
      ).toBe('idempotency_key_reused');
    });
  });
});
