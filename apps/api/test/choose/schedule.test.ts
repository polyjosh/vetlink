import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { slotWindow, type FarmerBookingView } from '@vetlink/shared';
import { bookings, notifications, payments, vets } from '../../src/db/schema/index.js';
import {
  appointmentSweep,
  eveningAppointmentReminders,
} from '../../src/modules/bookings/appointments.js';
import { Harness, errorCode, type Session } from '../helpers/harness.js';
import {
  createTestDatabase,
  DB_SETUP_TIMEOUT_MS,
  testServerUrl,
  type TestDatabase,
} from '../helpers/test-db.js';

const HOUR = 3600_000;
// Harness clock: Thursday 2026-10-15 09:00 in Nairobi. Friday morning is 23 hours away.
const FRIDAY = '2026-10-16';

describe.skipIf(!testServerUrl)('scheduled appointments (database)', { timeout: 60_000 }, () => {
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
    h.now = new Date('2026-10-15T06:00:00Z');
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
        'idempotency-key': `s-${randomUUID()}`,
      },
    );
  const list = async (farmer: Session, query: string) =>
    (await h.get(`/v1/vets/choose?species=cattle&${query}`, farmer.accessToken)).json<
      { vetId: string }[]
    >();
  const kinds = async (userId: string) =>
    (await h.db.select().from(notifications).where(eq(notifications.userId, userId))).map(
      (n) => n.kind,
    );

  /** A vet with working hours set (online or not). */
  async function vetWithHours(hours: object, online = false) {
    const v = await h.vet(wardId, 'approved', { online });
    await h.db.update(vets).set({ workingHours: hours }).where(eq(vets.userId, v.userId));
    return v;
  }
  const weekdays = { fri: [{ from: '08:00', to: '17:00' }] };

  it('slots must be within 14 days, at least 2 hours ahead, and only for a chosen vet', async () => {
    const farmer = await h.farmer(wardId);
    const vet = await vetWithHours(weekdays, true);
    const chosen = { dispatchMode: 'chosen', vetId: vet.userId };
    expect(
      errorCode(
        await book(farmer, { ...chosen, schedule: { date: '2026-10-15', part: 'morning' } }),
      ),
    ).toBe('invalid_request'); // started
    expect(
      errorCode(
        await book(farmer, { ...chosen, schedule: { date: '2026-10-31', part: 'morning' } }),
      ),
    ).toBe('invalid_request'); // too far
    expect(errorCode(await book(farmer, { schedule: { date: FRIDAY, part: 'morning' } }))).toBe(
      'invalid_request',
    ); // fastest available is never scheduled
    const ok = await book(farmer, { ...chosen, schedule: { date: FRIDAY, part: 'morning' } });
    expect(ok.statusCode).toBe(201);
    const b = ok.json<FarmerBookingView>();
    expect(b).toMatchObject({ status: 'requested', scheduledPart: 'morning' });
    expect(b.scheduledFor).toBe(slotWindow(FRIDAY, 'morning').start.toISOString());
    // Two hours to answer.
    expect(Date.parse(b.statusDeadlineAt ?? '') - h.now.getTime()).toBe(2 * HOUR);
  });

  it('a slot soon after now gives the vet until 1 hour before it starts', async () => {
    h.now = new Date('2026-10-15T06:30:00Z'); // 09:30 Nairobi; the afternoon starts 12:00
    const farmer = await h.farmer(wardId);
    const vet = await vetWithHours({ thu: [{ from: '08:00', to: '17:00' }] });
    const b = (
      await book(farmer, {
        dispatchMode: 'chosen',
        vetId: vet.userId,
        schedule: { date: '2026-10-15', part: 'afternoon' },
      })
    ).json<FarmerBookingView>();
    expect(b.statusDeadlineAt).toBe(
      new Date(slotWindow('2026-10-15', 'afternoon').start.getTime() - HOUR).toISOString(),
    );
  });

  it('booking ahead lists offline vets whose hours cover the slot, and not full ones', async () => {
    const farmer = await h.farmer(wardId);
    const fridays = await vetWithHours(weekdays); // offline now
    const sundays = await vetWithHours({ sun: [{ from: '08:00', to: '17:00' }] });
    const full = await vetWithHours(weekdays);
    await h.db.insert(bookings).values({
      farmerId: farmer.userId,
      vetId: full.userId,
      species: 'cattle',
      problemType: 'sick',
      sourceChannel: 'app',
      wardId,
      status: 'matched',
      feeQuoted: 600,
      dispatchMode: 'chosen',
      scheduledFor: slotWindow(FRIDAY, 'morning').start,
      scheduledPart: 'morning',
    });
    const ahead = await list(farmer, `date=${FRIDAY}&part=morning`);
    expect(ahead.map((v) => v.vetId)).toEqual([fridays.userId]);
    expect(ahead.map((v) => v.vetId)).not.toContain(sundays.userId);
    // The full vet is free in the afternoon.
    expect(
      (await list(farmer, `date=${FRIDAY}&part=afternoon`)).map((v) => v.vetId).sort(),
    ).toEqual([fridays.userId, full.userId].sort());
    // As soon as possible: online vets only; a visit booked for Friday does not hold them today.
    await h.db.update(vets).set({ isAvailable: true }).where(eq(vets.userId, full.userId));
    expect((await list(farmer, '')).map((v) => v.vetId)).toEqual([full.userId]);
  });

  describe('a booked visit', () => {
    async function bookedVisit() {
      const farmer = await h.farmer(wardId);
      const vet = await vetWithHours(weekdays);
      const [b] = await h.db
        .insert(bookings)
        .values({
          farmerId: farmer.userId,
          vetId: vet.userId,
          species: 'cattle',
          problemType: 'sick',
          sourceChannel: 'app',
          wardId,
          status: 'matched',
          feeQuoted: 600,
          dispatchMode: 'chosen',
          scheduledFor: slotWindow(FRIDAY, 'morning').start,
          scheduledPart: 'morning',
        })
        .returning();
      await h.db.insert(payments).values({
        bookingId: b?.id ?? 0,
        type: 'deposit',
        amount: 200,
        status: 'success',
      });
      return { farmer, vet, id: b?.id ?? 0 };
    }

    it('both sides are reminded the evening before and an hour before, once each', async () => {
      const { farmer, vet } = await bookedVisit();
      h.now = new Date('2026-10-15T15:00:00Z'); // 18:00 Thursday
      // (Other tests' Friday visits share this database, so check this visit's people.)
      expect(await eveningAppointmentReminders(h.ctx, h.app.log)).toBeGreaterThan(0);
      expect(await eveningAppointmentReminders(h.ctx, h.app.log)).toBe(0);
      h.now = new Date(slotWindow(FRIDAY, 'morning').start.getTime() - 50 * 60_000);
      await appointmentSweep(h.ctx, h.app.log);
      await appointmentSweep(h.ctx, h.app.log);
      for (const who of [farmer, vet]) {
        expect(await kinds(who.userId)).toEqual(['appointment_tomorrow', 'appointment_soon']);
      }
    });

    it('a vet who has not set off an hour in is flagged; the farmer cancels and gets credit', async () => {
      const { farmer, vet, id } = await bookedVisit();
      h.now = new Date(slotWindow(FRIDAY, 'morning').start.getTime() + 61 * 60_000);
      await appointmentSweep(h.ctx, h.app.log);
      await appointmentSweep(h.ctx, h.app.log);
      expect((await kinds(vet.userId)).filter((k) => k === 'appointment_overdue')).toHaveLength(1);
      expect(await kinds(farmer.userId)).toContain('appointment_late');
      const support = await h.admin('support');
      const board = (await h.get('/v1/admin/bookings?overdue=true', support.accessToken)).json<
        { id: number }[]
      >();
      expect(board.map((b) => b.id)).toContain(id);
      // (The farmer's token outlived this jump; sign in again.)
      const again = await h.login(farmer.phone);
      expect((await h.get(`/v1/bookings/${id}`, again.accessToken)).json()).toMatchObject({
        overdue: true,
      });
      await h.post(`/v1/bookings/${id}/cancel`, { reason: 'other' }, again.accessToken);
      expect((await h.get('/v1/wallet', again.accessToken)).json()).toMatchObject({ balance: 200 });
    });
  });
});
