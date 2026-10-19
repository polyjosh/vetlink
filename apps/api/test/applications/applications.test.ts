import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FarmerBookingView, VerificationStatus } from '@vetlink/shared';
import {
  adminProfiles,
  auditLog,
  bookingOffers,
  users,
  vetApplications,
  vetDocuments,
  vetServiceFees,
  vets,
} from '../../src/db/schema/index.js';
import { checkLicences } from '../../src/modules/vets/licence.js';
import { Harness, errorCode, type Session } from '../helpers/harness.js';
import {
  createTestDatabase,
  DB_SETUP_TIMEOUT_MS,
  testServerUrl,
  type TestDatabase,
} from '../helpers/test-db.js';

const SECRET = 'applications-webhook-secret-01234';

interface AppView {
  id: number;
  reference: string;
  status: string;
  currentStep: number;
  steps: Record<string, Record<string, unknown>>;
  missing: { fields: string[]; documents: string[] };
  editable: string;
  documents: { id: number; kind: string; status: string }[];
}

describe.skipIf(!testServerUrl)(
  'vet application and verification (database)',
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
      h = new Harness(tdb, { webhookSecret: SECRET, echoSmsReplies: true });
      h.now = new Date('2026-10-15T09:00:00Z');
      wardId = await h.ward();
    });
    afterEach(async () => {
      await h.close();
    });

    /** A signed-up applicant: consented, vet role, draft. */
    async function applicant(vetType: 'vet' | 'paravet' = 'vet'): Promise<Session> {
      const s = await h.login();
      await h.post('/v1/me/consent', {}, s.accessToken);
      await h.post('/v1/me/roles', { role: 'vet', vetType }, s.accessToken);
      return s;
    }

    const put = (s: Session, step: string, body: object) =>
      h.request('PUT', `/v1/vets/me/application/steps/${step}`, { token: s.accessToken, body });

    /** Upload a document the way the app does: presign, PUT to storage, confirm. */
    async function upload(s: Session, kind: string, contentType = 'image/jpeg', size = 300_000) {
      const pre = await h.post(
        '/v1/uploads/presign',
        { purpose: 'vet_document', documentKind: kind, contentType, size },
        s.accessToken,
      );
      const { storageKey } = pre.json<{ storageKey: string }>();
      h.storage.put(storageKey, size, contentType);
      return h.post('/v1/vets/me/application/documents', { kind, storageKey }, s.accessToken);
    }

    let idSeq = 10_000_000;
    /** Fill every step and upload every required document. */
    async function completeApplication(
      s: Session,
      options: { nationalId?: string; kvb?: string } = {},
    ) {
      await put(s, 'personal', {
        fullName: 'Dr. Achieng Otieno',
        nationalId: options.nationalId ?? String(idSeq++),
      });
      await put(s, 'credentials', {
        kvbRegNo: options.kvb ?? `KVB/${randomUUID().slice(0, 6)}`,
        kvbCategory: 'veterinary_surgeon',
        licenceExpiry: '2027-12-31',
        qualification: 'BVM',
        institution: 'University of Nairobi',
        yearQualified: 2015,
      });
      await put(s, 'practice', {
        practiceType: 'independent',
        yearsExperience: 9,
        species: ['cattle', 'goat'],
        services: ['treatment', 'vaccination'],
        languages: ['sw', 'en'],
      });
      await put(s, 'service_area', {
        wardId,
        serviceRadiusKm: 20,
        baseCallOutFee: 800,
        emergencyCallouts: true,
        consultationFee: 600,
        serviceFees: { treatment: 400, vaccination: 250 },
        offersCallOuts: true,
        hasPremises: false,
        workingHours: { mon: [{ from: '08:00', to: '17:00' }] },
      });
      await put(s, 'payout', { payoutMpesaPhone: s.phone });
      await put(s, 'declaration', {
        acceptTerms: true,
        consentVerification: true,
        declaration: true,
      });
      for (const kind of ['profile_photo', 'id_front', 'id_back', 'certificate', 'licence'])
        await upload(s, kind);
    }

    const view = async (s: Session) =>
      (await h.get('/v1/vets/me/application', s.accessToken)).json<AppView>();
    const vetStatus = async (s: Session) =>
      (await h.db.select().from(vets).where(eq(vets.userId, s.userId)))[0]?.verificationStatus;

    /** Submitted and claimed by a fresh verifier. */
    async function underReview(s: Session) {
      await completeApplication(s);
      await h.post('/v1/vets/me/application/submit', {}, s.accessToken);
      const verifier = await h.admin('verifier');
      const app = await view(s);
      await h.post(`/v1/admin/vet-applications/${app.id}/claim`, {}, verifier.accessToken);
      return { verifier, appId: app.id };
    }

    const decide = (admin: Session, appId: number, body: object) =>
      h.post(`/v1/admin/vet-applications/${appId}/decision`, body, admin.accessToken);

    describe('the wizard', () => {
      it('autosaves each step and resumes on another device; the ID number is never sent back', async () => {
        const s = await applicant();
        await put(s, 'personal', { fullName: 'Dr. Achieng Otieno', nationalId: '12345678' });
        await put(s, 'credentials', { kvbRegNo: 'KVB/1234' });
        const other = await h.login(s.phone); // a second device
        const resumed = await view(other);
        expect(resumed).toMatchObject({ status: 'draft', currentStep: 4, editable: 'all' });
        expect(resumed.steps.personal).toEqual({
          fullName: 'Dr. Achieng Otieno',
          nationalIdLast3: '678',
        });
        expect(resumed.steps.credentials).toEqual({ kvbRegNo: 'KVB/1234' });
        expect(JSON.stringify(resumed)).not.toContain('12345678');
        const [row] = await h.db
          .select()
          .from(vetApplications)
          .where(eq(vetApplications.id, resumed.id));
        expect(JSON.stringify(row?.data)).not.toContain('12345678'); // encrypted at rest
        expect(resumed.reference).toMatch(/^VL-2026-\d{4,}$/);
      });

      it('validates in plain terms: bad ID, fee outside the bands, radius too wide', async () => {
        const s = await applicant();
        expect((await put(s, 'personal', { nationalId: '12ab' })).json()).toMatchObject({
          code: 'invalid_request',
          details: { fields: ['nationalId'] }, // relative to the step being saved
        });
        expect((await put(s, 'service_area', { baseCallOutFee: 99_999 })).json()).toMatchObject({
          details: { fields: ['service_area.baseCallOutFee'], min: 200, max: 5000 },
        });
        expect(errorCode(await put(s, 'service_area', { serviceRadiusKm: 500 }))).toBe(
          'invalid_request',
        );
      });

      it('uploads: presign, PUT, confirm; checks type, size and that the file is really there', async () => {
        const s = await applicant();
        expect(
          (await upload(s, 'certificate')).json<AppView>().documents.map((d) => d.kind),
        ).toEqual(['certificate']);
        const big = await h.post(
          '/v1/uploads/presign',
          {
            purpose: 'vet_document',
            documentKind: 'licence',
            contentType: 'image/jpeg',
            size: 9e6,
          },
          s.accessToken,
        );
        expect(errorCode(big)).toBe('upload_invalid');
        const exe = await h.post(
          '/v1/uploads/presign',
          {
            purpose: 'vet_document',
            documentKind: 'licence',
            contentType: 'application/x-msdownload',
            size: 100,
          },
          s.accessToken,
        );
        expect(exe.statusCode).toBe(400);
        // Confirming before the upload finished.
        const pre = (
          await h.post(
            '/v1/uploads/presign',
            {
              purpose: 'vet_document',
              documentKind: 'licence',
              contentType: 'image/png',
              size: 1000,
            },
            s.accessToken,
          )
        ).json<{ storageKey: string }>();
        expect(
          errorCode(
            await h.post(
              '/v1/vets/me/application/documents',
              { kind: 'licence', storageKey: pre.storageKey },
              s.accessToken,
            ),
          ),
        ).toBe('upload_invalid');
        // Someone else's key.
        expect(
          errorCode(
            await h.post(
              '/v1/vets/me/application/documents',
              { kind: 'licence', storageKey: 'vet-documents/x/1/licence-y.png' },
              s.accessToken,
            ),
          ),
        ).toBe('upload_invalid');
        // A retry of a finished confirm is fine; a new upload of the same kind replaces the old one.
        h.storage.put(pre.storageKey, 1000, 'image/png');
        await h.post(
          '/v1/vets/me/application/documents',
          { kind: 'licence', storageKey: pre.storageKey },
          s.accessToken,
        );
        await h.post(
          '/v1/vets/me/application/documents',
          { kind: 'licence', storageKey: pre.storageKey },
          s.accessToken,
        );
        await upload(s, 'licence');
        const docs = (await view(s)).documents.filter((d) => d.kind === 'licence');
        expect(docs).toHaveLength(1);
        expect(h.storage.objects.has(pre.storageKey)).toBe(false); // old file removed
      });

      it('submit lists what is missing; a complete application goes to review and is read-only', async () => {
        const s = await applicant();
        const early = await h.post('/v1/vets/me/application/submit', {}, s.accessToken);
        expect(early.statusCode).toBe(422);
        expect(early.json()).toMatchObject({ code: 'application_incomplete' });
        expect(early.json<{ details: { documents: string[] } }>().details.documents).toContain(
          'certificate',
        );

        await completeApplication(s);
        const done = (
          await h.post('/v1/vets/me/application/submit', {}, s.accessToken)
        ).json<AppView>();
        expect(done).toMatchObject({ status: 'submitted', editable: 'none' });
        expect(await vetStatus(s)).toBe('submitted');
        expect(errorCode(await put(s, 'practice', { bio: 'changed' }))).toBe('application_locked');
        expect(h.sms.some((m) => m.phone === s.phone && m.text.includes(done.reference))).toBe(
          true,
        );
      });

      it('a paravet needs a training certificate instead of a licence', async () => {
        const s = await applicant('paravet');
        expect((await view(s)).missing.documents).toEqual([
          'profile_photo',
          'id_front',
          'id_back',
          'training_cert',
        ]);
      });

      it('can withdraw to edit until a reviewer claims it', async () => {
        const s = await applicant();
        await completeApplication(s);
        await h.post('/v1/vets/me/application/submit', {}, s.accessToken);
        expect(
          (await h.post('/v1/vets/me/application/withdraw', {}, s.accessToken)).json(),
        ).toMatchObject({ status: 'draft' });
        await h.post('/v1/vets/me/application/submit', {}, s.accessToken);
        const verifier = await h.admin('verifier');
        await h.post(
          `/v1/admin/vet-applications/${(await view(s)).id}/claim`,
          {},
          verifier.accessToken,
        );
        expect(errorCode(await h.post('/v1/vets/me/application/withdraw', {}, s.accessToken))).toBe(
          'application_locked',
        );
      });
    });

    describe('review', () => {
      it('only one verifier works an application; a super admin can take over', async () => {
        const s = await applicant();
        const { appId } = await underReview(s);
        const second = await h.admin('verifier');
        expect(
          errorCode(
            await h.post(`/v1/admin/vet-applications/${appId}/claim`, {}, second.accessToken),
          ),
        ).toBe('application_claimed');
        expect(errorCode(await decide(second, appId, { decision: 'approve' }))).toBe(
          'application_claimed',
        );
        const boss = await h.admin('super_admin');
        expect(
          (
            await h.post(
              `/v1/admin/vet-applications/${appId}/claim`,
              { force: true },
              boss.accessToken,
            )
          ).statusCode,
        ).toBe(204);
      });

      it('request changes: only flagged items are editable; resubmission goes first in the queue', async () => {
        const older = await applicant();
        await completeApplication(older);
        await h.post('/v1/vets/me/application/submit', {}, older.accessToken);
        h.advance(60_000);
        const s = await applicant();
        const { verifier, appId } = await underReview(s);
        expect(
          (
            await decide(verifier, appId, {
              decision: 'request_changes',
              reasons: ['certificate_unclear'],
              note: 'Certificate photo is blurry, please retake',
              flaggedFields: ['doc.certificate', 'credentials.kvbRegNo'],
            })
          ).statusCode,
        ).toBe(204);
        const v = await view(s);
        expect(v).toMatchObject({ status: 'changes_requested', editable: 'flagged' });
        expect(v.documents.find((d) => d.kind === 'certificate')?.status).toBe('flagged');
        expect(await vetStatus(s)).toBe('changes_requested');

        const locked = await put(s, 'personal', { fullName: 'Someone Else' });
        expect(locked.json()).toMatchObject({
          code: 'application_locked',
          details: { fields: ['personal.fullName'] },
        });
        expect((await put(s, 'credentials', { kvbRegNo: 'KVB/FIXED1' })).statusCode).toBe(200);
        // The licence was not flagged: no upload URL for it.
        const notFlagged = await h.post(
          '/v1/uploads/presign',
          {
            purpose: 'vet_document',
            documentKind: 'licence',
            contentType: 'image/jpeg',
            size: 1000,
          },
          s.accessToken,
        );
        expect(errorCode(notFlagged)).toBe('application_locked');
        expect((await upload(s, 'certificate')).statusCode).toBe(200);
        expect(
          (await h.post('/v1/vets/me/application/resubmit', {}, s.accessToken)).json(),
        ).toMatchObject({ status: 'submitted' });

        const queue = (
          await h.get('/v1/admin/vet-applications?status=submitted', verifier.accessToken)
        ).json<{ id: number; resubmission: boolean }[]>();
        expect(queue[0]).toMatchObject({ id: appId, resubmission: true });
      });

      it('approve: details become the live profile, but the vet is NOT put online', async () => {
        const s = await applicant();
        const { verifier, appId } = await underReview(s);
        expect(
          (
            await decide(verifier, appId, {
              decision: 'approve',
              checklist: { identity: { ok: true } },
            })
          ).statusCode,
        ).toBe(204);
        const [vet] = await h.db.select().from(vets).where(eq(vets.userId, s.userId));
        expect(vet).toMatchObject({
          verificationStatus: 'approved',
          isAvailable: false,
          specialties: ['cattle', 'goat'],
          baseCallOutFee: 800,
          consultationFee: 600,
          offersCallOuts: true,
          badges: ['verified'], // recomputed on approval (§24.8)
          wardId,
          payoutMpesaPhone: s.phone,
        });
        const fees = await h.db
          .select()
          .from(vetServiceFees)
          .where(eq(vetServiceFees.vetId, s.userId));
        expect(Object.fromEntries(fees.map((f) => [f.service, f.feeFromKes]))).toEqual({
          treatment: 400,
          vaccination: 250,
        });
        expect(vet?.verifiedAt).not.toBeNull();
        const [u] = await h.db.select().from(users).where(eq(users.id, s.userId));
        expect(u?.name).toBe('Dr. Achieng Otieno');
        expect((await view(s)).documents.every((d) => d.status === 'accepted')).toBe(true);
        // The verified profile photo is copied to become the public photo (§24.1).
        const me = (await h.get('/v1/me', s.accessToken)).json<{ photo: { url: string | null } }>();
        expect(me.photo.url).toContain(`media%2F${s.userId}%2Favatar-`);
        expect(
          [...h.storage.objects.keys()].filter((k) => k.startsWith(`media/${s.userId}/`)),
        ).toHaveLength(1);
        const audits = await h.db
          .select()
          .from(auditLog)
          .where(eq(auditLog.entityId, String(appId)));
        expect(audits.map((a) => a.action)).toEqual(
          expect.arrayContaining(['vet_application.claimed', 'vet_application.approve']),
        );
        // They go online themselves.
        expect(
          (
            await h.request('PATCH', '/v1/vets/me/availability', {
              token: s.accessToken,
              body: { isAvailable: true },
            })
          ).statusCode,
        ).toBe(200);
      });

      it('reject keeps the vet offline for good', async () => {
        const s = await applicant();
        const { verifier, appId } = await underReview(s);
        expect(errorCode(await decide(verifier, appId, { decision: 'reject', reasons: [] }))).toBe(
          'invalid_request',
        );
        await decide(verifier, appId, {
          decision: 'reject',
          reasons: ['kvb_unverifiable'],
          note: 'Number not on the register',
        });
        expect(await vetStatus(s)).toBe('rejected');
        expect(
          errorCode(
            await h.request('PATCH', '/v1/vets/me/availability', {
              token: s.accessToken,
              body: { isAvailable: true },
            }),
          ),
        ).toBe('vet_not_approved');
        expect((await view(s)).status).toBe('rejected');
      });

      it('the reviewer sees the ID and duplicate flags; documents open via short, logged links', async () => {
        const first = await applicant();
        await completeApplication(first, { nationalId: '87654321', kvb: 'KVB/DUP1' });
        await h.post('/v1/vets/me/application/submit', {}, first.accessToken);
        const verifier = await h.admin('verifier');
        const a1 = (await view(first)).id;
        await h.post(`/v1/admin/vet-applications/${a1}/claim`, {}, verifier.accessToken);
        await decide(verifier, a1, { decision: 'approve' });

        const copy = await applicant();
        await completeApplication(copy, { nationalId: '87654321', kvb: 'kvb/dup1' });
        const a2 = (await view(copy)).id;
        const detail = await h.get(`/v1/admin/vet-applications/${a2}`, verifier.accessToken);
        expect(detail.json()).toMatchObject({
          nationalId: '87654321',
          duplicates: [{ userId: first.userId, matches: ['national_id', 'kvb'] }],
        });

        const docId = (await view(copy)).documents[0]?.id;
        const link = await h.get(`/v1/admin/vet-documents/${docId}/url`, verifier.accessToken);
        expect(link.json<{ url: string }>().url).toMatch(/expires=300/);
        const audits = await h.db
          .select()
          .from(auditLog)
          .where(
            and(eq(auditLog.action, 'vet_document.viewed'), eq(auditLog.entityId, String(docId))),
          );
        expect(audits).toHaveLength(1);
        const support = await h.admin('support');
        expect(
          (await h.get(`/v1/admin/vet-documents/${docId}/url`, support.accessToken)).statusCode,
        ).toBe(404);
        expect(
          (await h.get(`/v1/admin/vet-applications/${a2}`, support.accessToken)).statusCode,
        ).toBe(404);
        expect((await h.get(`/v1/admin/vet-applications/${a2}`, copy.accessToken)).statusCode).toBe(
          404,
        );
      });
    });

    describe('assisted onboarding (four-eyes)', () => {
      it('the assisting admin cannot approve; the vet must consent and submit themselves', async () => {
        const helper = await h.admin('verifier');
        const phone = Harness.nextPhone();
        const started = await h.post(
          '/v1/admin/vet-applications',
          { phone, vetType: 'vet', name: 'Kamau' },
          helper.accessToken,
        );
        expect(started.statusCode).toBe(201);
        const { applicationId } = started.json<{ applicationId: number }>();
        // The admin fills steps for them.
        const fill = (step: string, body: object) =>
          h.request('PUT', `/v1/admin/vet-applications/${applicationId}/steps/${step}`, {
            token: helper.accessToken,
            body,
          });
        expect(
          (await fill('personal', { fullName: 'Peter Kamau', nationalId: '23456789' })).statusCode,
        ).toBe(204);
        // Another admin may not edit it.
        const other = await h.admin('verifier');
        expect(
          errorCode(
            await h.request('PUT', `/v1/admin/vet-applications/${applicationId}/steps/personal`, {
              token: other.accessToken,
              body: { fullName: 'X Y Z' },
            }),
          ),
        ).toBe('application_locked');

        // The vet signs in with their own number, completes and submits; consent comes first.
        const vet = await h.login(phone);
        await completeApplication(vet);
        expect(errorCode(await h.post('/v1/vets/me/application/submit', {}, vet.accessToken))).toBe(
          'consent_required',
        );
        await h.post('/v1/me/consent', {}, vet.accessToken);
        expect(
          (await h.post('/v1/vets/me/application/submit', {}, vet.accessToken)).statusCode,
        ).toBe(200);

        await h.post(`/v1/admin/vet-applications/${applicationId}/claim`, {}, helper.accessToken);
        const self = await decide(helper, applicationId, { decision: 'approve' });
        expect(self.json()).toMatchObject({ code: 'forbidden', details: { reason: 'four_eyes' } });
        const boss = await h.admin('super_admin');
        await h.post(
          `/v1/admin/vet-applications/${applicationId}/claim`,
          { force: true },
          boss.accessToken,
        );
        expect((await decide(boss, applicationId, { decision: 'approve' })).statusCode).toBe(204);
      });
    });

    describe('gating: no offers until approved (invariant 2)', () => {
      async function paidBookingNear() {
        const farmer = await h.farmer(wardId);
        const id = (
          await h.post(
            '/v1/bookings',
            { species: 'cattle', problemType: 'sick' },
            farmer.accessToken,
            { 'idempotency-key': `g-${randomUUID()}` },
          )
        ).json<FarmerBookingView>().id;
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
                  Item: [{ Name: 'MpesaReceiptNumber', Value: `G${randomUUID().slice(0, 8)}` }],
                },
              },
            },
          },
        });
        return id;
      }
      const offeredTo = async (bookingId: number) =>
        (await h.db.select().from(bookingOffers).where(eq(bookingOffers.bookingId, bookingId))).map(
          (o) => o.vetId,
        );

      it.each<VerificationStatus>([
        'draft',
        'submitted',
        'under_review',
        'changes_requested',
        'rejected',
        'suspended',
      ])('a %s vet is never offered a job, whatever their other details', async (status) => {
        const s = await h.vet(wardId, status);
        const id = await paidBookingNear();
        expect(await offeredTo(id)).not.toContain(s.userId);
      });

      it('suspension: offline at once, open offers withdrawn, cannot accept or go online; reinstating leaves them offline', async () => {
        const s = await h.vet(wardId);
        const id = await paidBookingNear();
        expect(await offeredTo(id)).toContain(s.userId);
        const verifier = await h.admin('verifier');
        const url = `/v1/admin/vets/${s.userId}/suspend`;
        expect(errorCode(await h.post(url, { reasons: ['other'] }, verifier.accessToken))).toBe(
          'step_up_required',
        );
        await h.stepUp(verifier);
        expect(
          (
            await h.post(
              url,
              { reasons: ['fraudulent_documents'], note: 'Under investigation' },
              verifier.accessToken,
            )
          ).statusCode,
        ).toBe(204);

        const [vet] = await h.db.select().from(vets).where(eq(vets.userId, s.userId));
        expect(vet).toMatchObject({ verificationStatus: 'suspended', isAvailable: false });
        const [offer] = await h.db
          .select()
          .from(bookingOffers)
          .where(and(eq(bookingOffers.bookingId, id), eq(bookingOffers.vetId, s.userId)));
        expect(offer?.response).toBe('timeout');
        expect(
          errorCode(
            await h.post(`/v1/bookings/${id}/offers/${offer?.id}/accept`, {}, s.accessToken),
          ),
        ).toBe('vet_not_approved');
        expect(
          errorCode(
            await h.request('PATCH', '/v1/vets/me/availability', {
              token: s.accessToken,
              body: { isAvailable: true },
            }),
          ),
        ).toBe('vet_not_approved');
        const sms = await h.app.inject({
          method: 'POST',
          url: `/webhooks/sms?token=${SECRET}`,
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          payload: new URLSearchParams({ from: s.phone, text: 'ON', id: randomUUID() }).toString(),
        });
        expect(sms.json<{ reply: string }>().reply).toMatch(/haijathibitishwa/);

        await h.post(
          `/v1/admin/vets/${s.userId}/reinstate`,
          { note: 'Cleared after review' },
          verifier.accessToken,
        );
        expect((await h.db.select().from(vets).where(eq(vets.userId, s.userId)))[0]).toMatchObject({
          verificationStatus: 'approved',
          isAvailable: false,
        });
      });

      it('an expired licence auto-suspends; a licence expiring in 30 days is warned once', async () => {
        const expired = await h.vet(wardId);
        await h.db
          .update(vets)
          .set({ licenceExpiry: '2026-10-14' })
          .where(eq(vets.userId, expired.userId));
        const soon = await h.vet(wardId);
        await h.db
          .update(vets)
          .set({ licenceExpiry: '2026-11-10' })
          .where(eq(vets.userId, soon.userId));
        await checkLicences(h.ctx, h.app.log);
        await checkLicences(h.ctx, h.app.log);
        expect(
          (await h.db.select().from(vets).where(eq(vets.userId, expired.userId)))[0],
        ).toMatchObject({ verificationStatus: 'suspended', isAvailable: false });
        expect(
          (await h.db.select().from(vets).where(eq(vets.userId, soon.userId)))[0]
            ?.verificationStatus,
        ).toBe('approved');
        const warnings = h.sms.filter((m) => m.phone === soon.phone && /siku 30/.test(m.text));
        expect(warnings).toHaveLength(1);
      });
    });

    describe('changes after approval', () => {
      it('non-critical edits apply at once; critical ones need a reviewed new version (vet stays approved)', async () => {
        const s = await applicant();
        const { verifier, appId } = await underReview(s);
        await decide(verifier, appId, { decision: 'approve' });

        expect(
          (
            await h.request('PATCH', '/v1/vets/me/profile', {
              token: s.accessToken,
              body: { baseCallOutFee: 1200, bio: 'Dairy specialist' },
            })
          ).statusCode,
        ).toBe(200);
        expect((await h.db.select().from(vets).where(eq(vets.userId, s.userId)))[0]).toMatchObject({
          baseCallOutFee: 1200,
          bio: 'Dairy specialist',
        });
        expect(
          errorCode(
            await h.request('PATCH', '/v1/vets/me/profile', {
              token: s.accessToken,
              body: { baseCallOutFee: 1 },
            }),
          ),
        ).toBe('invalid_request');

        const v2 = (await h.post('/v1/vets/me/application/new-version', {}, s.accessToken)).json<
          AppView & { version: number }
        >();
        expect(v2).toMatchObject({ version: 2, status: 'draft' });
        expect((await put(s, 'credentials', { kvbRegNo: 'KVB/NEW-99' })).statusCode).toBe(200);
        const sub = await h.post('/v1/vets/me/application/submit', {}, s.accessToken);
        expect(sub.statusCode, sub.body).toBe(200);
        expect(await vetStatus(s)).toBe('approved'); // still working meanwhile
        expect(
          (await h.db.select().from(vets).where(eq(vets.userId, s.userId)))[0]?.kvbRegNo,
        ).not.toBe('KVB/NEW-99');

        const claim = await h.post(
          `/v1/admin/vet-applications/${v2.id}/claim`,
          {},
          verifier.accessToken,
        );
        expect(claim.statusCode, claim.body).toBe(204);
        const approve = await decide(verifier, v2.id, { decision: 'approve' });
        expect(approve.statusCode, approve.body).toBe(204);
        expect((await h.db.select().from(vets).where(eq(vets.userId, s.userId)))[0]).toMatchObject({
          kvbRegNo: 'KVB/NEW-99',
          verificationStatus: 'approved',
        });
        const docs = await h.db
          .select()
          .from(vetDocuments)
          .where(eq(vetDocuments.applicationId, v2.id));
        expect(docs.length).toBeGreaterThan(0);
      });
    });

    describe('admin grants (super admin)', () => {
      it('grants a role with a 72 h enrolment window, and revokes it (step-up, audited)', async () => {
        const boss = await h.admin('super_admin');
        const newbie = await h.login();
        expect(
          errorCode(
            await h.post(
              '/v1/admin/admins',
              { phone: newbie.phone, role: 'verifier' },
              boss.accessToken,
            ),
          ),
        ).toBe('step_up_required');
        await h.stepUp(boss);
        const granted = await h.post(
          '/v1/admin/admins',
          { phone: newbie.phone, role: 'verifier' },
          boss.accessToken,
        );
        expect(granted.json()).toMatchObject({ userId: newbie.userId, role: 'verifier' });
        const [profile] = await h.db
          .select()
          .from(adminProfiles)
          .where(eq(adminProfiles.userId, newbie.userId));
        expect(profile?.totpEnrolExpiresAt?.getTime()).toBe(h.now.getTime() + 72 * 3600 * 1000);
        // They can now enrol their authenticator.
        expect((await h.post('/v1/auth/2fa/setup', {}, newbie.accessToken)).statusCode).toBe(200);
        expect(
          (
            await h.request('DELETE', `/v1/admin/admins/${newbie.userId}`, {
              token: boss.accessToken,
            })
          ).statusCode,
        ).toBe(204);
        expect((await h.get('/v1/me', newbie.accessToken)).json()).toMatchObject({ admin: null });
        const verifier = await h.admin('verifier');
        expect((await h.get('/v1/admin/admins', verifier.accessToken)).statusCode).toBe(404);
      });
    });
  },
);
