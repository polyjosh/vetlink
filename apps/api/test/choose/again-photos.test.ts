import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FarmerBookingView, OfferView } from '@vetlink/shared';
import { animals, bookings, notifications, treatments } from '../../src/db/schema/index.js';
import { Harness, errorCode, type Session } from '../helpers/harness.js';
import {
  createTestDatabase,
  DB_SETUP_TIMEOUT_MS,
  testServerUrl,
  type TestDatabase,
} from '../helpers/test-db.js';

describe.skipIf(!testServerUrl)(
  'book again and request photos (database)',
  { timeout: 60_000 },
  () => {
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
      h = new Harness(tdb);
      wardId = await h.ward();
    });
    afterEach(async () => {
      await h.close();
    });

    const book = (farmer: Session, body: object) =>
      h.post(
        '/v1/bookings',
        { species: 'cattle', problemType: 'sick', ...body },
        farmer.accessToken,
        {
          'idempotency-key': `a-${randomUUID()}`,
        },
      );

    async function finished(farmer: Session, vet: Session, animalId: string | null = null) {
      const [b] = await h.db
        .insert(bookings)
        .values({
          farmerId: farmer.userId,
          vetId: vet.userId,
          animalId,
          species: 'cattle',
          problemType: 'sick',
          sourceChannel: 'app',
          wardId,
          status: 'done',
          feeQuoted: 600,
          completedAt: h.now,
        })
        .returning();
      return b;
    }

    it('recent vets: most recent first, one per vet, with whether they can be asked now', async () => {
      const farmer = await h.farmer(wardId);
      const a = await h.vet(wardId);
      const b = await h.vet(wardId, 'approved', { online: false });
      const [cow] = await h.db
        .insert(animals)
        .values({ farmerId: farmer.userId, species: 'cattle', nameOrTag: 'Daisy' })
        .returning();
      await finished(farmer, a);
      h.advance(60_000);
      await finished(farmer, b);
      h.advance(60_000);
      await finished(farmer, a, cow?.id ?? null);
      const recent = (await h.get('/v1/farmers/me/recent-vets', farmer.accessToken)).json<
        { vetId: string; available: boolean; animalId: string | null }[]
      >();
      expect(recent.map((r) => [r.vetId, r.available])).toEqual([
        [a.userId, true],
        [b.userId, false],
      ]);
      expect(recent[0]?.animalId).toBe(cow?.id);
    });

    it('rebooking a follow-up links it to the treatment, so the vet stops being alerted', async () => {
      const farmer = await h.farmer(wardId);
      const other = await h.farmer(wardId);
      const vet = await h.vet(wardId);
      const done = await finished(farmer, vet);
      const [t] = await h.db
        .insert(treatments)
        .values({ bookingId: done?.id ?? 0, rawNotes: 'x', followUpDate: '2026-10-25' })
        .returning();
      // Someone else's treatment is ignored.
      await book(other, {
        dispatchMode: 'chosen',
        vetId: vet.userId,
        followUpOfTreatmentId: t?.id,
      });
      expect(
        (
          await h.db
            .select()
            .from(treatments)
            .where(eq(treatments.id, t?.id ?? 0))
        )[0]?.followUpBookingId,
      ).toBeNull();
      await h.db
        .update(bookings)
        .set({ status: 'cancelled' })
        .where(eq(bookings.farmerId, other.userId));

      const again = (
        await book(farmer, {
          dispatchMode: 'chosen',
          vetId: vet.userId,
          followUpOfTreatmentId: t?.id,
        })
      ).json<FarmerBookingView>();
      const view = (
        await h.get(`/v1/bookings/${done?.id}`, farmer.accessToken)
      ).json<FarmerBookingView>();
      expect(view.treatment).toMatchObject({ id: t?.id, followUpBookingId: again.id });
    });

    it('a farmer adds up to 3 photos; the vet sees them before accepting; the SMS says so', async () => {
      const farmer = await h.farmer(wardId);
      const other = await h.farmer(wardId);
      const vet = await h.vet(wardId);
      const booking = (
        await book(farmer, { dispatchMode: 'chosen', vetId: vet.userId })
      ).json<FarmerBookingView>();

      async function addPhoto(s: Session, id: number) {
        const pre = await h.post(
          '/v1/uploads/presign',
          { purpose: 'photo', photoKind: 'booking_photo', contentType: 'image/jpeg', size: 90_000 },
          s.accessToken,
        );
        const { storageKey } = pre.json<{ storageKey: string }>();
        h.storage.put(storageKey, 90_000, 'image/jpeg');
        return h.request('PUT', `/v1/bookings/${id}/photos`, {
          token: s.accessToken,
          body: { storageKey },
        });
      }
      for (let i = 0; i < 3; i++) expect((await addPhoto(farmer, booking.id)).statusCode).toBe(204);
      expect(errorCode(await addPhoto(farmer, booking.id))).toBe('photo_invalid'); // a 4th
      expect(errorCode(await addPhoto(other, booking.id))).toBe('not_found');

      const offers = (await h.get('/v1/vets/me/offers', vet.accessToken)).json<OfferView[]>();
      expect(offers[0]?.photos).toHaveLength(3);
      const seen = (
        await h.get(`/v1/bookings/${booking.id}`, farmer.accessToken)
      ).json<FarmerBookingView>();
      expect(seen.photos).toHaveLength(3);

      // A request made after the photos carries the note in its SMS (the vet has no app here).
      const second = (
        await book(other, { dispatchMode: 'chosen', vetId: (await h.vet(wardId)).userId })
      ).json<FarmerBookingView>();
      expect(second.photos).toEqual([]);
      const sent = await h.db.select().from(notifications).where(eq(notifications.kind, 'request'));
      expect(sent.length).toBeGreaterThan(0);
    });
  },
);
