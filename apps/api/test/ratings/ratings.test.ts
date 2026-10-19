import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FarmerBookingView } from '@vetlink/shared';
import {
  animals,
  auditLog,
  bookingOffers,
  bookings,
  notifications,
  reminders,
  treatments,
  users,
  vets,
} from '../../src/db/schema/index.js';
import { morningReminders, sendVetFollowUpAlerts } from '../../src/modules/reminders/service.js';
import { updateBadges } from '../../src/modules/vets/badges.js';
import { Harness, errorCode, type Session } from '../helpers/harness.js';
import {
  createTestDatabase,
  DB_SETUP_TIMEOUT_MS,
  testServerUrl,
  type TestDatabase,
} from '../helpers/test-db.js';

describe.skipIf(!testServerUrl)(
  'ratings, follow-ups, reminders, badges (database)',
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
      // 06:00 UTC = 09:00 in Nairobi.
      h.now = new Date('2026-10-20T06:00:00Z');
      wardId = await h.ward();
    });
    afterEach(async () => {
      await h.close();
    });

    /** A finished job between this farmer and vet (as if completed through the app). */
    async function doneJob(
      farmer: Session,
      vet: Session,
      extra: Partial<typeof bookings.$inferInsert> = {},
    ) {
      const [b] = await h.db
        .insert(bookings)
        .values({
          farmerId: farmer.userId,
          vetId: vet.userId,
          species: 'cattle',
          problemType: 'sick',
          sourceChannel: 'app',
          wardId,
          status: 'done',
          feeQuoted: 500,
          completedAt: h.now,
          ...extra,
        })
        .returning();
      if (!b) throw new Error('no booking');
      return b;
    }

    const rate = (farmer: Session, bookingId: number, body: object) =>
      h.post(`/v1/bookings/${bookingId}/rating`, body, farmer.accessToken);
    const kinds = async (userId: string) =>
      (await h.db.select().from(notifications).where(eq(notifications.userId, userId))).map(
        (n) => n.kind,
      );

    describe('rating tags and review flags (§24.7)', () => {
      it('stores tags; unknown tags are refused; the farmer sees them', async () => {
        const farmer = await h.farmer(wardId);
        const vet = await h.vet(wardId);
        const b = await doneJob(farmer, vet);
        expect((await rate(farmer, b.id, { stars: 5, tags: ['magic'] })).statusCode).toBe(400);
        expect(
          (await rate(farmer, b.id, { stars: 5, tags: ['on_time', 'fair_price', 'on_time'] }))
            .statusCode,
        ).toBe(204);
        expect((await rate(farmer, b.id, { stars: 5 })).statusCode).toBe(204); // retry
        const view = (
          await h.get(`/v1/bookings/${b.id}`, farmer.accessToken)
        ).json<FarmerBookingView>();
        expect(view.rating).toEqual({ stars: 5, comment: null, tags: ['on_time', 'fair_price'] });
      });

      it('a rude low rating, or 3 low ratings in 30 days, flags the vet; a verifier clears it', async () => {
        const farmer = await h.farmer(wardId);
        const rude = await h.vet(wardId);
        const low = await h.vet(wardId);
        const fine = await h.vet(wardId);

        await rate(farmer, (await doneJob(farmer, fine)).id, { stars: 5, tags: ['rude'] }); // 5 stars: no
        await rate(farmer, (await doneJob(farmer, rude)).id, { stars: 2, tags: ['rude'] });
        for (let i = 0; i < 3; i++) {
          await rate(farmer, (await doneJob(farmer, low)).id, { stars: 1 });
          if (i < 2) {
            const [v] = await h.db.select().from(vets).where(eq(vets.userId, low.userId));
            expect(v?.reviewFlaggedAt).toBeNull();
          }
        }
        const flagOf = async (s: Session) =>
          (await h.db.select().from(vets).where(eq(vets.userId, s.userId)))[0]?.reviewFlagReason;
        expect(await flagOf(rude)).toBe('rude_rating');
        expect(await flagOf(low)).toBe('repeated_low_ratings');
        expect(await flagOf(fine)).toBeNull();
        // The flag never takes anyone offline.
        expect(
          (await h.db.select().from(vets).where(eq(vets.userId, rude.userId)))[0]?.isAvailable,
        ).toBe(true);

        const verifier = await h.admin('verifier');
        const support = await h.admin('support');
        expect(errorCode(await h.get('/v1/admin/vets/flagged', support.accessToken))).toBe(
          'not_found',
        );
        const list = (await h.get('/v1/admin/vets/flagged', verifier.accessToken)).json<
          { vetUserId: string; reason: string }[]
        >();
        expect(list.map((l) => l.reason).sort()).toEqual(['repeated_low_ratings', 'rude_rating']);

        const clear = (body: object) =>
          h.post(`/v1/admin/vets/${rude.userId}/review-flag/clear`, body, verifier.accessToken);
        expect((await clear({ note: 'Called the farmer; misunderstanding' })).statusCode).toBe(204);
        expect(errorCode(await clear({ note: 'again' }))).toBe('not_found');
        expect(await flagOf(rude)).toBeNull();
        const audits = await h.db
          .select()
          .from(auditLog)
          .where(eq(auditLog.action, 'vet.review_flag_cleared'));
        expect(audits).toHaveLength(1);
      });
    });

    describe("the vet's ratings and follow-ups (§24.4)", () => {
      it('ratings summary never names the farmer; a vet sees only their own', async () => {
        const farmer = await h.farmer(wardId);
        await h.request('PATCH', '/v1/me', {
          token: farmer.accessToken,
          body: { name: 'Wanjiku Kamau', displayName: 'Mama Daisy' },
        });
        const vet = await h.vet(wardId);
        const other = await h.vet(wardId);
        await rate(farmer, (await doneJob(farmer, vet)).id, {
          stars: 4,
          tags: ['explained_well'],
          comment: 'Good work',
        });
        await rate(farmer, (await doneJob(farmer, vet)).id, { stars: 5, tags: ['explained_well'] });
        await rate(farmer, (await doneJob(farmer, other)).id, { stars: 1 });

        const res = await h.get('/v1/vets/me/ratings', vet.accessToken);
        const body = res.json<{
          average: number;
          count: number;
          distribution: Record<string, number>;
          tagCounts: Record<string, number>;
          items: { stars: number }[];
        }>();
        expect(body).toMatchObject({ average: 4.5, count: 2 });
        expect(body.distribution).toMatchObject({ 4: 1, 5: 1, 1: 0 });
        expect(body.tagCounts.explained_well).toBe(2);
        const raw = JSON.stringify(body);
        for (const secret of ['Wanjiku', 'Mama Daisy', farmer.phone, farmer.userId]) {
          expect(raw).not.toContain(secret);
        }
        expect(errorCode(await h.get('/v1/vets/me/ratings', farmer.accessToken))).toBe('forbidden');
      });

      it("follow-ups list: from today on; the farmer's contact only within 7 days", async () => {
        const farmer = await h.farmer(wardId);
        const vet = await h.vet(wardId);
        const add = async (date: string) => {
          const b = await doneJob(farmer, vet);
          await h.db
            .insert(treatments)
            .values({ bookingId: b.id, rawNotes: 'x', followUpDate: date, diagnosis: 'ECF' });
          return b.id;
        };
        await add('2026-10-19'); // yesterday: gone
        const soon = await add('2026-10-22');
        const later = await add('2026-11-30');
        const list = (await h.get('/v1/vets/me/follow-ups', vet.accessToken)).json<
          { bookingId: number; farmer: { phone: string } | null }[]
        >();
        expect(list.map((f) => f.bookingId)).toEqual([soon, later]);
        expect(list[0]?.farmer?.phone).toBe(farmer.phone);
        expect(list[1]?.farmer).toBeNull();
      });

      it('alerts the vet the evening before and on the day, once; not after rebooking or suspension', async () => {
        const farmer = await h.farmer(wardId);
        const vet = await h.vet(wardId);
        const suspended = await h.vet(wardId);
        const job = async (v: Session, date: string, rebooked = false) => {
          const b = await doneJob(farmer, v);
          const next = rebooked ? await doneJob(farmer, v, { status: 'matched' }) : null;
          await h.db.insert(treatments).values({
            bookingId: b.id,
            rawNotes: 'x',
            followUpDate: date,
            followUpBookingId: next?.id ?? null,
          });
        };
        await job(vet, '2026-10-21'); // tomorrow
        await job(vet, '2026-10-21', true); // tomorrow, already rebooked
        await job(suspended, '2026-10-21');
        await h.db
          .update(vets)
          .set({ verificationStatus: 'suspended', isAvailable: false })
          .where(eq(vets.userId, suspended.userId));

        expect(await sendVetFollowUpAlerts(h.ctx, 'evening', h.app.log)).toBe(1);
        expect(await sendVetFollowUpAlerts(h.ctx, 'evening', h.app.log)).toBe(0); // rerun
        expect(await kinds(vet.userId)).toEqual(['followup_tomorrow']);
        expect(await kinds(suspended.userId)).toEqual([]);

        h.now = new Date('2026-10-21T04:00:00Z'); // 07:00 Nairobi on the day
        await morningReminders(h.ctx, h.app.log);
        await morningReminders(h.ctx, h.app.log);
        expect(await kinds(vet.userId)).toEqual(['followup_tomorrow', 'followup_today']);
      });
    });

    it('farmer reminders go out once on the due day, in their language (§8.8)', async () => {
      const farmer = await h.farmer(wardId);
      await h.db.update(users).set({ language: 'en' }).where(eq(users.id, farmer.userId));
      const [cow] = await h.db
        .insert(animals)
        .values({ farmerId: farmer.userId, species: 'cattle', nameOrTag: 'Daisy' })
        .returning();
      await h.db.insert(reminders).values([
        { animalId: cow?.id ?? '', type: 'vaccine', dueDate: '2026-10-20' },
        { animalId: cow?.id ?? '', type: 'deworm', dueDate: '2026-10-25' },
      ]);
      await morningReminders(h.ctx, h.app.log);
      await morningReminders(h.ctx, h.app.log);
      const sent = await h.db
        .select()
        .from(notifications)
        .where(
          and(eq(notifications.userId, farmer.userId), eq(notifications.kind, 'reminder_due')),
        );
      expect(sent).toHaveLength(1);
      // No app: the reminder went by SMS, rendered in English.
      expect(h.sms.at(-1)?.text).toContain('Vaccine for your Cow Daisy is due today');
    });

    describe('badges (§24.8)', () => {
      it('are earned from the record and lost on suspension', async () => {
        const farmer = await h.farmer(wardId);
        const star = await h.vet(wardId);
        const plain = await h.vet(wardId);
        for (let i = 0; i < 50; i++) {
          const b = await doneJob(farmer, star, i < 10 ? { problemType: 'vaccination' } : {});
          if (i < 10) await rate(farmer, b.id, { stars: 5 });
          if (i < 10) {
            await h.db.insert(bookingOffers).values({
              bookingId: b.id,
              vetId: star.userId,
              wave: 1,
              channel: 'push',
              sentAt: new Date(h.now.getTime() - 3600_000),
              respondedAt: new Date(h.now.getTime() - 3600_000 + 20_000),
              response: 'accepted',
            });
          }
        }
        await updateBadges(h.ctx, h.app.log);
        const badgesOf = async (s: Session) =>
          (await h.db.select().from(vets).where(eq(vets.userId, s.userId)))[0]?.badges;
        expect((await badgesOf(star))?.sort()).toEqual(
          ['fast_responder', 'jobs_50', 'top_rated', 'verified'].sort(),
        );
        expect(await badgesOf(plain)).toEqual(['verified']);

        const me = (await h.get('/v1/vets/me', star.accessToken)).json<{ badges: string[] }>();
        expect(me.badges).toContain('top_rated');
        const view = (
          await h.get(`/v1/bookings/${(await doneJob(farmer, star)).id}`, farmer.accessToken)
        ).json<FarmerBookingView>();
        expect(view.vet?.badges).toContain('top_rated');

        await h.db
          .update(vets)
          .set({ verificationStatus: 'suspended', isAvailable: false })
          .where(eq(vets.userId, star.userId));
        const hidden = (
          await h.get(`/v1/bookings/${view.id}`, farmer.accessToken)
        ).json<FarmerBookingView>();
        expect(hidden.vet?.badges).toEqual([]);
        await updateBadges(h.ctx, h.app.log);
        expect(await badgesOf(star)).toEqual([]);
      });
    });
  },
);
