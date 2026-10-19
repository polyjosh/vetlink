import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  animals,
  bookings,
  ratings,
  reminders,
  smsInbound,
  treatments,
  users,
  vets,
} from '../../src/db/schema/index.js';
import { createOffer } from '../../src/modules/bookings/service.js';
import { transition } from '../../src/modules/bookings/transitions.js';
import { Harness, type Session } from '../helpers/harness.js';
import {
  createTestDatabase,
  DB_SETUP_TIMEOUT_MS,
  testServerUrl,
  type TestDatabase,
} from '../helpers/test-db.js';

const SECRET = 'sms-webhook-secret-0123456789abcd';

describe.skipIf(!testServerUrl)('SMS commands (database)', { timeout: 60_000 }, () => {
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
    h.now = new Date('2026-10-15T09:00:00Z');
    wardId = await h.ward();
  });
  afterEach(async () => {
    await h.close();
  });

  /** An inbound SMS through the Africa's Talking webhook; returns the reply text. */
  async function text(from: string, body: string, id = randomUUID()): Promise<string | null> {
    const res = await h.app.inject({
      method: 'POST',
      url: `/webhooks/sms?token=${SECRET}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ from: `+${from}`, text: body, id, to: '20880' }).toString(),
    });
    expect(res.statusCode).toBe(200);
    return res.json<{ reply: string | null }>().reply;
  }

  /** A pending booking with an offer to `vet` (as dispatch would leave it). */
  async function offeredJob(vet: Session, farmer?: Session) {
    const f = farmer ?? (await h.farmer(wardId));
    const res = await h.post(
      '/v1/bookings',
      { species: 'cattle', problemType: 'sick' },
      f.accessToken,
      {
        'idempotency-key': `s-${randomUUID()}`,
      },
    );
    const bookingId = res.json<{ id: number }>().id;
    await h.db.transaction((tx) =>
      transition(tx, bookingId, 'deposit_confirmed', { kind: 'system' }, h.now),
    );
    await createOffer(h.ctx, { bookingId, vetId: vet.userId, wave: 1, channel: 'sms' });
    return { bookingId, farmer: f };
  }

  const statusOf = async (id: number) =>
    (await h.db.select().from(bookings).where(eq(bookings.id, id)))[0]?.status;

  const english = (s: Session) =>
    h.db.update(users).set({ language: 'en' }).where(eq(users.id, s.userId));

  it('the M9 demo: book by USSD, accept by SMS, complete by SMS, farmer rates by SMS', async () => {
    const vet = await h.vet(wardId);
    await english(vet);
    const farmer = await h.farmer(wardId);
    const [cow] = await h.db
      .insert(animals)
      .values({ farmerId: farmer.userId, species: 'cattle', nameOrTag: 'Wanjiru' })
      .returning({ id: animals.id });

    // 1. The farmer books on USSD (returning user: request, cow, sick, saved ward, confirm).
    const sid = `ATUid_${randomUUID()}`;
    const ussd = (t: string) =>
      h.app.inject({
        method: 'POST',
        url: `/webhooks/ussd?token=${SECRET}`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({
          sessionId: sid,
          phoneNumber: farmer.phone,
          text: t,
        }).toString(),
      });
    await ussd('');
    const end = await ussd('1*1*1*1*1*1'); // request, cow, sick, saved ward, fastest (§24.6), confirm
    const ref = Number(/Ombi (\d+)/.exec(end.body)?.[1]);
    expect(end.body).toMatch(/^END Ombi \d+ limetumwa/);
    await h.db
      .update(bookings)
      .set({ animalId: cow?.id ?? null })
      .where(eq(bookings.id, ref));

    // 2. M-Pesa confirms the deposit; dispatch offers the job to the vet by SMS (no app).
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
              Item: [{ Name: 'MpesaReceiptNumber', Value: `D${randomUUID().slice(0, 8)}` }],
            },
          },
        },
      },
    });
    const offerSms = h.sms.filter((m) => m.phone === vet.phone).at(-1)?.text ?? '';
    expect(offerSms).toMatch(new RegExp(`^VETLINK JOB ${ref}\\n`));

    // 3. The vet accepts by SMS and gets the farmer's contact.
    const accepted = await text(vet.phone, `y ${ref}`);
    expect(accepted).toContain(`Job ${ref} is yours`);
    expect(accepted).toContain(farmer.phone);
    expect(await statusOf(ref)).toBe('matched');

    // 4. On the way, arrived, done (with notes parsed into the treatment record).
    expect(await text(vet.phone, `OTW ${ref}`)).toContain('on the way');
    expect(await text(vet.phone, `arr${ref}`)).toContain('arrived');
    expect(await text(vet.phone, `DONE ${ref} ECF; oxytet 20ml; f/u 7d`)).toContain(
      `Job ${ref} completed`,
    );
    expect(await statusOf(ref)).toBe('done');
    const [treatment] = await h.db.select().from(treatments).where(eq(treatments.bookingId, ref));
    expect(treatment).toMatchObject({
      diagnosis: 'ECF',
      diagnosisCode: 'ecf',
      drugsUsed: 'oxytet 20ml',
      rawNotes: 'ECF; oxytet 20ml; f/u 7d',
      followUpDate: '2026-10-22',
    });
    const [reminder] = await h.db
      .select()
      .from(reminders)
      .where(eq(reminders.animalId, cow?.id ?? ''));
    expect(reminder).toMatchObject({ type: 'follow_up', dueDate: '2026-10-22' });

    // 5. The farmer was told at each step, and rates by SMS.
    const farmerSms = h.sms.filter((m) => m.phone === farmer.phone).map((m) => m.text);
    expect(farmerSms.at(-1)).toContain(`R${ref} 1-5`);
    expect(await text(farmer.phone, `R${ref} 5 asante sana`)).toMatch(/Asante kwa kutoa tathmini/);
    const [rating] = await h.db.select().from(ratings).where(eq(ratings.bookingId, ref));
    expect(rating).toMatchObject({ stars: 5, comment: 'asante sana' });
    const [vetRow] = await h.db.select().from(vets).where(eq(vets.userId, vet.userId));
    expect(vetRow?.rating).toBe('5.0');
    expect(h.jobs.failed).toEqual([]);
  });

  describe('vet commands', () => {
    it('a command without a job number uses the only open offer / active job', async () => {
      const vet = await h.vet(wardId);
      await english(vet);
      const { bookingId } = await offeredJob(vet);
      expect(await text(vet.phone, 'Y')).toContain(`Job ${bookingId} is yours`);
      expect(await text(vet.phone, 'otw')).toContain(`job ${bookingId}`);
      expect(await statusOf(bookingId)).toBe('en_route');
    });

    it('asks which job when it cannot tell', async () => {
      const vet = await h.vet(wardId);
      await english(vet);
      await offeredJob(vet);
      await offeredJob(vet);
      expect(await text(vet.phone, 'Y')).toBe(
        'Which job? Reply Y with the job number, e.g. Y4821.',
      );
    });

    it('first accept wins across channels: app accepts, SMS hears "taken"', async () => {
      const a = await h.vet(wardId);
      const b = await h.vet(wardId);
      await english(b);
      const { bookingId } = await offeredJob(a);
      await createOffer(h.ctx, { bookingId, vetId: b.userId, wave: 1, channel: 'sms' });
      const offers = (await h.get('/v1/vets/me/offers', a.accessToken)).json<
        { offerId: number }[]
      >();
      const [app, sms] = await Promise.all([
        h.post(`/v1/bookings/${bookingId}/offers/${offers[0]?.offerId}/accept`, {}, a.accessToken),
        text(b.phone, `Y${bookingId}`),
      ]);
      const winners = [app.statusCode === 200, Boolean(sms?.includes('is yours'))].filter(Boolean);
      expect(winners).toHaveLength(1);
      if (app.statusCode === 200)
        expect(sms).toBe(`Sorry, job ${bookingId} was already taken by another vet.`);
    });

    it('decline by SMS; a job that is not yours gets a clear answer', async () => {
      const vet = await h.vet(wardId);
      await english(vet);
      const { bookingId } = await offeredJob(vet);
      expect(await text(vet.phone, `N${bookingId}`)).toBe(`OK, you declined job ${bookingId}.`);
      expect(await text(vet.phone, 'Y999999')).toBe('There is no open job 999999 for you.');
    });

    it('ON and OFF toggle availability; an unapproved vet gets "not yet verified"', async () => {
      const vet = await h.vet(wardId, 'approved', { online: false });
      await english(vet);
      expect(await text(vet.phone, 'ON')).toMatch(/^You are ONLINE/);
      expect(
        (await h.db.select().from(vets).where(eq(vets.userId, vet.userId)))[0]?.isAvailable,
      ).toBe(true);
      expect(await text(vet.phone, 'off')).toMatch(/^You are OFFLINE/);

      const pending = await h.vet(wardId, 'submitted');
      await english(pending);
      const expected =
        'Your VetLink account is not yet verified. We will SMS you when it is approved.';
      expect(await text(pending.phone, 'ON')).toBe(expected);
      expect(await text(pending.phone, 'Y4821')).toBe(expected);
      expect(
        (await h.db.select().from(vets).where(eq(vets.userId, pending.userId)))[0]?.isAvailable,
      ).toBe(false);
    });

    it('steps out of order get a polite refusal; repeats are harmless', async () => {
      const vet = await h.vet(wardId);
      await english(vet);
      const { bookingId } = await offeredJob(vet);
      await text(vet.phone, `Y${bookingId}`);
      expect(await text(vet.phone, `ARR ${bookingId}`)).toBe(
        `Job ${bookingId} cannot do that now. Reply HELP for the commands.`,
      );
      expect(await text(vet.phone, `OTW ${bookingId}`)).toContain('on the way');
      expect(await text(vet.phone, `OTW ${bookingId}`)).toContain('on the way'); // repeat: fine
    });

    it('DONE with notes that do not parse still completes the job (raw text kept)', async () => {
      const vet = await h.vet(wardId);
      const { bookingId } = await offeredJob(vet);
      await text(vet.phone, `Y${bookingId}`);
      await text(vet.phone, `DONE ${bookingId} gave 1.5 ml of the usual`);
      expect(await statusOf(bookingId)).toBe('done');
      const [t] = await h.db.select().from(treatments).where(eq(treatments.bookingId, bookingId));
      expect(t?.rawNotes).toBe('gave 1.5 ml of the usual');
    });

    it('unknown text gets the help menu in the vet language', async () => {
      const vet = await h.vet(wardId);
      expect(await text(vet.phone, 'habari yako')).toMatch(/^Amri za daktari VetLink/);
    });
  });

  describe('safety', () => {
    it('a resent SMS (same provider id) is processed once', async () => {
      const vet = await h.vet(wardId);
      const { bookingId } = await offeredJob(vet);
      const id = randomUUID();
      expect(await text(vet.phone, `Y${bookingId}`, id)).toContain(`Kazi ${bookingId}`);
      expect(await text(vet.phone, `Y${bookingId}`, id)).toBeNull();
      const stored = await h.db
        .select()
        .from(smsInbound)
        .where(eq(smsInbound.providerMessageId, id));
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ command: 'accept', text: `Y${bookingId}` });
    });

    it('farmers cannot run vet commands; unknown numbers get the USSD pointer', async () => {
      const farmer = await h.farmer(wardId);
      expect(await text(farmer.phone, 'ON')).toMatch(/^VetLink: piga \*123#/);
      expect(await text(Harness.nextPhone(), 'Y4821')).toMatch(/^VetLink: piga \*123#/);
    });

    it("a farmer cannot rate someone else's visit by guessing its number", async () => {
      const vet = await h.vet(wardId);
      const { bookingId } = await offeredJob(vet);
      await text(vet.phone, `Y${bookingId}`);
      await text(vet.phone, `DONE ${bookingId} ok`);
      const stranger = await h.farmer(wardId);
      expect(await text(stranger.phone, `R${bookingId} 1`)).toBe(
        `Hakuna kazi ${bookingId} iliyo wazi kwako.`,
      );
      expect(await h.db.select().from(ratings).where(eq(ratings.bookingId, bookingId))).toEqual([]);
    });

    it('rejects a wrong token, and never logs numbers or message text', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/webhooks/sms?token=wrong',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'from=%2B254700000000&text=Y1&id=x',
      });
      expect(res.statusCode).toBe(404);
      const vet = await h.vet(wardId);
      await text(vet.phone, 'DONE 1 SecretDiagnosisText');
      const out = h.logs.join('');
      expect(out).not.toContain(vet.phone);
      expect(out).not.toContain('SecretDiagnosisText');
    });
  });
});
