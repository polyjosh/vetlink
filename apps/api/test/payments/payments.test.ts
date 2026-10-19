import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FarmerBookingView } from '@vetlink/shared';
import {
  auditLog,
  bookingEvents,
  bookings,
  farmers,
  notifications,
  payments,
  walletEntries,
} from '../../src/db/schema/index.js';
import { expireCredit } from '../../src/modules/wallet/service.js';
import { reconcilePayments } from '../../src/modules/payments/service.js';
import { createOffer } from '../../src/modules/bookings/service.js';
import { darajaPassword, darajaTimestamp } from '../../src/modules/payments/daraja.js';
import { Harness, MINUTE, errorCode, type Session } from '../helpers/harness.js';
import {
  createTestDatabase,
  DB_SETUP_TIMEOUT_MS,
  testServerUrl,
  type TestDatabase,
} from '../helpers/test-db.js';

const SECRET = 'payments-webhook-secret-0123456789';

describe.skipIf(!testServerUrl)('payments (database)', { timeout: 60_000 }, () => {
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
    wardId = await h.ward();
  });
  afterEach(async () => {
    await h.close();
  });

  interface PaymentView {
    id: number;
    status: string;
    amount: number;
    receipt: string | null;
  }

  async function booked(farmer?: Session) {
    const f = farmer ?? (await h.farmer(wardId));
    const res = await h.post(
      '/v1/bookings',
      { species: 'cattle', problemType: 'sick' },
      f.accessToken,
      { 'idempotency-key': `pay-${randomUUID()}` },
    );
    return { farmer: f, bookingId: res.json<FarmerBookingView>().id };
  }

  const pay = (f: Session, bookingId: number) =>
    h.post('/v1/payments/stk', { bookingId }, f.accessToken);

  const booking = async (f: Session, id: number) =>
    (await h.get(`/v1/bookings/${id}`, f.accessToken)).json<FarmerBookingView>();

  /** Daraja's callback body. */
  function callback(
    checkoutRequestId: string,
    resultCode: number,
    meta?: { amount?: number; receipt?: string },
  ) {
    return {
      Body: {
        stkCallback: {
          MerchantRequestID: 'MR-x',
          CheckoutRequestID: checkoutRequestId,
          ResultCode: resultCode,
          ResultDesc:
            resultCode === 0
              ? 'The service request is processed successfully.'
              : 'Request cancelled by user',
          ...(resultCode === 0 && {
            CallbackMetadata: {
              Item: [
                { Name: 'Amount', Value: meta?.amount ?? 200 },
                {
                  Name: 'MpesaReceiptNumber',
                  Value:
                    meta?.receipt ?? `R${randomUUID().replace(/-/g, '').slice(0, 9).toUpperCase()}`,
                },
                { Name: 'TransactionDate', Value: 20261015090000 },
                { Name: 'PhoneNumber', Value: 254700000000 },
              ],
            },
          }),
        },
      },
    };
  }

  const postCallback = (body: object, token = SECRET) =>
    h.app.inject({ method: 'POST', url: `/webhooks/mpesa?token=${token}`, payload: body });

  /** M-Pesa really did this, and the callback says so. */
  async function mpesaSays(
    checkoutRequestId: string,
    resultCode: number,
    meta?: { amount?: number; receipt?: string },
  ) {
    h.gateway.outcomes.set(checkoutRequestId, {
      checkoutRequestId,
      resultCode,
      resultDesc: resultCode === 0 ? 'ok' : 'cancelled',
    });
    return postCallback(callback(checkoutRequestId, resultCode, meta));
  }

  const paymentRows = (bookingId: number) =>
    h.db.select().from(payments).where(eq(payments.bookingId, bookingId)).orderBy(payments.id);

  describe('deposit happy path', () => {
    it('sends one STK push for the server-set amount; a confirmed callback starts the search', async () => {
      const { farmer, bookingId } = await booked();
      const res = await h.post('/v1/payments/stk', { bookingId, amount: 1 }, farmer.accessToken);
      expect(res.statusCode).toBe(202);
      expect(res.json()).toMatchObject({ type: 'deposit', amount: 200, status: 'pending' });
      expect(h.gateway.last()).toMatchObject({
        phone: farmer.phone,
        amount: 200, // never the client's
        accountReference: `VL${bookingId}`,
      });
      expect((await booking(farmer, bookingId)).deposit.status).toBe('pending');

      const ack = await mpesaSays(h.gateway.last().checkoutRequestId, 0, { receipt: 'TJK7RT61SV' });
      expect(ack.statusCode).toBe(200);
      expect(ack.json()).toEqual({ ResultCode: 0, ResultDesc: 'Accepted' });

      const view = await booking(farmer, bookingId);
      expect(view.status).toBe('pending');
      expect(view.deposit).toMatchObject({ status: 'paid', receipt: 'TJK7RT61SV' });
      expect(view.timeline.map((t) => t.event)).toEqual(['deposit_confirmed']);
      const paymentId = view.deposit.paymentId;
      const polled = await h.get(`/v1/payments/${paymentId}`, farmer.accessToken);
      expect(polled.json()).toMatchObject({ status: 'success', receipt: 'TJK7RT61SV' });
    });

    it('a retry while a prompt is out returns the same payment and sends no second prompt', async () => {
      const { farmer, bookingId } = await booked();
      const results = await Promise.all([1, 2, 3, 4, 5].map(() => pay(farmer, bookingId)));
      const ids = new Set(results.map((r) => r.json<PaymentView>().id));
      expect(ids.size).toBe(1);
      expect(h.gateway.pushes).toHaveLength(1);
      expect(await paymentRows(bookingId)).toHaveLength(1);
    });

    it('paying an already-paid booking returns the paid deposit', async () => {
      const { farmer, bookingId } = await booked();
      await pay(farmer, bookingId);
      await mpesaSays(h.gateway.last().checkoutRequestId, 0);
      const again = await pay(farmer, bookingId);
      expect(again.json()).toMatchObject({ status: 'success' });
      expect(h.gateway.pushes).toHaveLength(1);
    });
  });

  describe('untrusted callbacks', () => {
    it('a duplicate callback changes nothing', async () => {
      const { farmer, bookingId } = await booked();
      await pay(farmer, bookingId);
      const id = h.gateway.last().checkoutRequestId;
      await mpesaSays(id, 0, { receipt: 'DUP0000001' });
      await mpesaSays(id, 0, { receipt: 'DUP0000001' });
      await postCallback(callback(id, 1032)); // and a contradictory late one
      const rows = await paymentRows(bookingId);
      expect(rows).toMatchObject([{ status: 'success', mpesaReceipt: 'DUP0000001' }]);
      const events = await h.db
        .select()
        .from(bookingEvents)
        .where(eq(bookingEvents.bookingId, bookingId));
      expect(events.filter((e) => e.event === 'deposit_confirmed')).toHaveLength(1);
    });

    it('a "success" callback that M-Pesa does not confirm is not counted', async () => {
      const { farmer, bookingId } = await booked();
      await pay(farmer, bookingId);
      const id = h.gateway.last().checkoutRequestId;
      // Forged or early: M-Pesa still says processing.
      expect((await postCallback(callback(id, 0))).statusCode).toBe(200);
      expect((await paymentRows(bookingId))[0]?.status).toBe('pending');
      // M-Pesa says the customer cancelled: the callback is overruled.
      h.gateway.outcomes.set(id, {
        checkoutRequestId: id,
        resultCode: 1032,
        resultDesc: 'cancelled',
      });
      // A repeat of the same callback is deduplicated (as in BullMQ); the first one's retry asks
      // M-Pesa again and gets the real answer.
      await postCallback(callback(id, 0));
      h.advance(10_000);
      await h.jobs.runDue();
      expect((await paymentRows(bookingId))[0]?.status).toBe('cancelled');
      expect((await booking(farmer, bookingId)).status).toBe('pending_payment');
    });

    it('rejects a wrong token and ignores unknown checkouts', async () => {
      expect((await postCallback(callback('ws_CO_x', 0), 'wrong')).statusCode).toBe(404);
      const unknown = await postCallback(callback('ws_CO_UNKNOWN', 0));
      expect(unknown.json()).toEqual({ ResultCode: 0, ResultDesc: 'Accepted' });
    });

    it('an amount mismatch is never counted as paid, and is audited', async () => {
      const { farmer, bookingId } = await booked();
      await pay(farmer, bookingId);
      await mpesaSays(h.gateway.last().checkoutRequestId, 0, { amount: 1 });
      const [row] = await paymentRows(bookingId);
      expect(row).toMatchObject({ status: 'failed', resultDesc: 'amount_mismatch' });
      expect((await booking(farmer, bookingId)).status).toBe('pending_payment');
      const audits = await h.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.entityId, String(row?.id)));
      expect(audits.map((a) => a.action)).toContain('payment.amount_mismatch');
    });
  });

  describe('failure and retry', () => {
    it('a cancelled prompt leaves the booking payable; the retry sends a new prompt', async () => {
      const { farmer, bookingId } = await booked();
      await pay(farmer, bookingId);
      await mpesaSays(h.gateway.last().checkoutRequestId, 1032);
      const view = await booking(farmer, bookingId);
      expect(view).toMatchObject({ status: 'pending_payment', deposit: { status: 'failed' } });

      h.advance(3 * MINUTE); // Daraja refuses the same amount to the same number within 2 min
      const retry = await pay(farmer, bookingId);
      expect(retry.json()).toMatchObject({ status: 'pending' });
      expect(h.gateway.pushes).toHaveLength(2);
      await mpesaSays(h.gateway.last().checkoutRequestId, 0);
      expect((await booking(farmer, bookingId)).deposit.status).toBe('paid');
    });

    it('M-Pesa unavailable: 503, the attempt is marked failed, and a retry works', async () => {
      const { farmer, bookingId } = await booked();
      h.gateway.rejectPushes = true;
      const res = await pay(farmer, bookingId);
      expect(res.statusCode).toBe(503);
      expect(errorCode(res)).toBe('payment_unavailable');
      expect((await paymentRows(bookingId))[0]).toMatchObject({
        status: 'failed',
        resultDesc: 'stk_push_rejected',
      });
      h.gateway.rejectPushes = false;
      expect((await pay(farmer, bookingId)).statusCode).toBe(202);
    });

    it('cannot pay for a booking that is no longer awaiting payment', async () => {
      const { farmer, bookingId } = await booked();
      await h.post(
        `/v1/bookings/${bookingId}/cancel`,
        { reason: 'changed_mind' },
        farmer.accessToken,
      );
      expect(errorCode(await pay(farmer, bookingId))).toBe('invalid_transition');
      expect(h.gateway.pushes).toHaveLength(0);
    });
  });

  describe('late and stuck payments (reconciliation)', () => {
    it('a payment that lands after the farmer cancelled becomes VetLink credit', async () => {
      const { farmer, bookingId } = await booked();
      await pay(farmer, bookingId);
      await h.post(
        `/v1/bookings/${bookingId}/cancel`,
        { reason: 'changed_mind' },
        farmer.accessToken,
      );
      await mpesaSays(h.gateway.last().checkoutRequestId, 0);
      const view = await booking(farmer, bookingId);
      expect(view).toMatchObject({ status: 'cancelled', deposit: { status: 'credited' } });
      const rows = await paymentRows(bookingId);
      expect(rows.map((r) => [r.type, r.status])).toEqual([['deposit', 'success']]);
      expect((await h.get('/v1/wallet', farmer.accessToken)).json()).toMatchObject({
        balance: 200,
      });
    });

    it('no callback: after 2 minutes reconciliation asks M-Pesa and settles the payment', async () => {
      const { farmer, bookingId } = await booked();
      await pay(farmer, bookingId);
      const id = h.gateway.last().checkoutRequestId;
      h.gateway.outcomes.set(id, { checkoutRequestId: id, resultCode: 0, resultDesc: 'ok' });
      h.advance(MINUTE);
      const queriesBefore = h.gateway.queries;
      await reconcilePayments(h.ctx, h.app.log);
      expect((await paymentRows(bookingId))[0]?.status).toBe('pending'); // too early to ask
      h.advance(2 * MINUTE);
      await reconcilePayments(h.ctx, h.app.log);
      expect(h.gateway.queries).toBeGreaterThan(queriesBefore);
      expect((await paymentRows(bookingId))[0]?.status).toBe('success');
      const [row] = await h.db.select().from(bookings).where(eq(bookings.id, bookingId));
      expect(row?.status).toBe('pending');
      // Running again (or concurrently) changes nothing.
      await Promise.all([reconcilePayments(h.ctx, h.app.log), reconcilePayments(h.ctx, h.app.log)]);
      const events = await h.db
        .select()
        .from(bookingEvents)
        .where(eq(bookingEvents.bookingId, bookingId));
      expect(events.filter((e) => e.event === 'deposit_confirmed')).toHaveLength(1);
    });

    it('no outcome after 30 minutes: the payment fails, then the unpaid booking expires', async () => {
      const { farmer, bookingId } = await booked();
      await pay(farmer, bookingId);
      h.advance(31 * MINUTE);
      const statusNow = async () =>
        (await h.db.select().from(bookings).where(eq(bookings.id, bookingId)))[0]?.status;
      // One run gives up on the payment, then expires the booking that has nothing in flight.
      await reconcilePayments(h.ctx, h.app.log);
      expect((await paymentRows(bookingId))[0]).toMatchObject({
        status: 'failed',
        resultDesc: 'no_result',
      });
      expect(await statusNow()).toBe('expired');
    });

    it('an unpaid booking expires after 30 minutes; a paid one never does', async () => {
      const a = await booked();
      const b = await booked();
      await pay(b.farmer, b.bookingId);
      await mpesaSays(h.gateway.last().checkoutRequestId, 0);
      h.advance(31 * MINUTE);
      await reconcilePayments(h.ctx, h.app.log);
      const [ra] = await h.db.select().from(bookings).where(eq(bookings.id, a.bookingId));
      const [rb] = await h.db.select().from(bookings).where(eq(bookings.id, b.bookingId));
      expect([ra?.status, rb?.status]).toEqual(['expired', 'pending']);
    });
  });

  describe('wallet instead of refunds (§24.25)', () => {
    it('a cancelled paid booking credits the wallet; the next booking is paid from it', async () => {
      const { farmer, bookingId } = await booked();
      await pay(farmer, bookingId);
      await mpesaSays(h.gateway.last().checkoutRequestId, 0);
      const cancel = () =>
        h.post(
          `/v1/bookings/${bookingId}/cancel`,
          { reason: 'found_other_help' },
          farmer.accessToken,
        );
      await cancel();
      await cancel(); // a retried cancellation never credits twice
      expect((await booking(farmer, bookingId)).deposit.status).toBe('credited');
      const wallet = (await h.get('/v1/wallet', farmer.accessToken)).json<{
        balance: number;
        entries: { kind: string }[];
      }>();
      expect(wallet).toMatchObject({ balance: 200 });
      expect(wallet.entries.map((e) => e.kind)).toEqual(['credit_cancelled']);
      const told = await h.db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, farmer.userId));
      expect(told.map((n) => n.kind)).toContain('wallet_credited');

      const quote = await h.get('/v1/bookings/quote?species=cattle', farmer.accessToken);
      expect(quote.json()).toMatchObject({ walletCredit: 200 });
      const pushes = h.gateway.pushes.length;
      const next = await booked(farmer);
      const paid = await pay(farmer, next.bookingId);
      expect(paid.json()).toMatchObject({ status: 'success', method: 'wallet' });
      expect(h.gateway.pushes).toHaveLength(pushes); // no M-Pesa prompt
      expect((await booking(farmer, next.bookingId)).status).toBe('pending');
      expect((await h.get('/v1/wallet', farmer.accessToken)).json()).toMatchObject({ balance: 0 });
    });

    it('credit that covers part of a higher fee: M-Pesa asks only for the rest', async () => {
      const { farmer, bookingId } = await booked();
      await pay(farmer, bookingId);
      await mpesaSays(h.gateway.last().checkoutRequestId, 0);
      await h.post(
        `/v1/bookings/${bookingId}/cancel`,
        { reason: 'changed_mind' },
        farmer.accessToken,
      );
      const boss = await h.admin('super_admin');
      await h.stepUp(boss);
      await h.request('PUT', '/v1/admin/config/payments.bookingFeeKes', {
        token: boss.accessToken,
        body: { value: 300 },
      });
      const next = await booked(farmer);
      const res = await pay(farmer, next.bookingId);
      expect(res.json()).toMatchObject({ status: 'pending', amount: 300 });
      expect(h.gateway.last().amount).toBe(100);
      // The credit is only taken once M-Pesa confirms its part.
      expect((await h.get('/v1/wallet', farmer.accessToken)).json()).toMatchObject({
        balance: 200,
      });
      await mpesaSays(h.gateway.last().checkoutRequestId, 0, { amount: 100 });
      expect((await booking(farmer, next.bookingId)).status).toBe('pending');
      expect((await h.get('/v1/wallet', farmer.accessToken)).json()).toMatchObject({ balance: 0 });
      // Config lives in this file's shared database: put the fee back (step-up still fresh).
      await h.request('PUT', '/v1/admin/config/payments.bookingFeeKes', {
        token: boss.accessToken,
        body: { value: 200 },
      });
    });

    it('finance views and corrects a wallet with step-up; never below zero; audited', async () => {
      const farmer = await h.farmer(wardId);
      const finance = await h.admin('finance');
      const support = await h.admin('support');
      const url = `/v1/admin/users/${farmer.userId}/wallet`;
      expect((await h.get(url, support.accessToken)).statusCode).toBe(404);
      expect((await h.get(url, finance.accessToken)).json()).toMatchObject({ balance: 0 });
      const adjust = (amount: number) =>
        h.post(`${url}/adjust`, { amount, note: 'Goodwill after an outage' }, finance.accessToken);
      expect(errorCode(await adjust(100))).toBe('step_up_required');
      await h.stepUp(finance);
      expect((await adjust(100)).json()).toMatchObject({ balance: 100 });
      expect(errorCode(await adjust(-500))).toBe('invalid_request');
      const audits = await h.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, 'wallet.adjusted'));
      expect(audits).toHaveLength(1);
    });

    it('credit unused for 12 months expires', async () => {
      const farmer = await h.farmer(wardId);
      await h.db.insert(walletEntries).values({
        userId: farmer.userId,
        amount: 200,
        kind: 'adjustment',
        note: 'test',
        createdAt: h.now,
      });
      const mine = () =>
        h.db.select().from(walletEntries).where(eq(walletEntries.userId, farmer.userId));
      // (Other tests' wallets share this database, so only this farmer's entries are checked.)
      h.advance(364 * 24 * 3600 * 1000);
      await expireCredit(h.ctx, h.app.log);
      expect((await mine()).map((r) => r.kind)).toEqual(['adjustment']);
      h.advance(2 * 24 * 3600 * 1000);
      await expireCredit(h.ctx, h.app.log);
      await expireCredit(h.ctx, h.app.log); // once only
      expect(await expireCredit(h.ctx, h.app.log)).toBe(0);
      const rows = await h.db
        .select()
        .from(walletEntries)
        .where(eq(walletEntries.userId, farmer.userId));
      expect(rows.map((r) => [r.kind, r.amount])).toEqual([
        ['adjustment', 200],
        ['expired', -200],
      ]);
    });

    it('no source file creates an M-Pesa refund any more', () => {
      const srcDir = new URL('../../src/', import.meta.url).pathname;
      const files = (dir: string): string[] =>
        readdirSync(dir).flatMap((name) => {
          const path = join(dir, name);
          return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
        });
      const offenders = files(srcDir).filter((path) =>
        /type:\s*'refund'/.test(readFileSync(path, 'utf8')),
      );
      expect(offenders).toEqual([]);
    });

    it('cancelling once the vet is on the way forfeits the deposit (no refund)', async () => {
      const { farmer, bookingId } = await booked();
      await pay(farmer, bookingId);
      await mpesaSays(h.gateway.last().checkoutRequestId, 0);
      const vet = await h.vet(wardId);
      const offerId = await createOffer(h.ctx, {
        bookingId,
        vetId: vet.userId,
        wave: 1,
        channel: 'push',
      });
      await h.post(`/v1/bookings/${bookingId}/offers/${offerId}/accept`, {}, vet.accessToken);
      await h.post(`/v1/bookings/${bookingId}/status`, { status: 'en_route' }, vet.accessToken);
      await h.post(
        `/v1/bookings/${bookingId}/cancel`,
        { reason: 'changed_mind' },
        farmer.accessToken,
      );
      expect((await paymentRows(bookingId)).map((r) => r.type)).toEqual(['deposit']);
      expect((await booking(farmer, bookingId)).deposit.status).toBe('paid');
    });

    it('other admin permissions cannot see or settle payments', async () => {
      const support = await h.admin('support');
      expect((await h.get('/v1/admin/payments', support.accessToken)).statusCode).toBe(404);
    });
  });

  describe('who can pay what', () => {
    it("another farmer cannot pay for or read someone else's booking payment", async () => {
      const { farmer, bookingId } = await booked();
      const other = await h.farmer(wardId);
      expect((await pay(other, bookingId)).statusCode).toBe(404);
      const paid = (await pay(farmer, bookingId)).json<PaymentView>();
      expect((await h.get(`/v1/payments/${paid.id}`, other.accessToken)).statusCode).toBe(404);
      const vet = await h.vet(wardId);
      expect((await pay(vet, bookingId)).statusCode).toBe(403);
    });
  });

  describe('USSD confirm sends the STK push', () => {
    async function ussd(phone: string, text: string, sessionId: string) {
      return h.app.inject({
        method: 'POST',
        url: `/webhooks/ussd?token=${SECRET}`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({ sessionId, phoneNumber: phone, text }).toString(),
      });
    }

    it('confirming on USSD prompts M-Pesa; if M-Pesa is down the booking is kept', async () => {
      const f = await h.farmer(wardId);
      const sid = `ATUid_${randomUUID()}`;
      await ussd(f.phone, '', sid);
      const done = await ussd(f.phone, '1*1*1*1*1', sid);
      expect(done.body).toMatch(/^END Ombi \d+ limetumwa/);
      expect(h.gateway.pushes).toHaveLength(1);
      expect(h.gateway.last().phone).toBe(f.phone);

      h.gateway.rejectPushes = true;
      const sid2 = `ATUid_${randomUUID()}`;
      await ussd(f.phone, '', sid2);
      const kept = await ussd(f.phone, '1*1*1*1*1', sid2);
      expect(kept.body).toMatch(/^END Ombi \d+ limehifadhiwa, lakini M-Pesa haipatikani/);
      const [farm] = await h.db.select().from(farmers).where(eq(farmers.userId, f.userId));
      expect(farm).toBeDefined();
    });
  });

  it('Daraja password and timestamp follow the documented format', () => {
    // 2026-10-15 06:00 UTC is 09:00 in Nairobi.
    expect(darajaTimestamp(new Date('2026-10-15T06:00:00Z'))).toBe('20261015090000');
    expect(
      Buffer.from(darajaPassword('174379', 'passkey', '20261015090000'), 'base64').toString(),
    ).toBe('174379passkey20261015090000');
  });
});
