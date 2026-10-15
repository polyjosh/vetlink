import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiClient } from '@vetlink/api-client';
import { Harness, errorCode } from '../helpers/harness.js';
import {
  createTestDatabase,
  DB_SETUP_TIMEOUT_MS,
  testServerUrl,
  type TestDatabase,
} from '../helpers/test-db.js';

describe.skipIf(!testServerUrl)(
  'profile, onboarding, animals (database)',
  { timeout: 30_000 },
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

    /** The generated client, talking to the in-process app (no network). */
    function client(token?: string) {
      return createApiClient({
        baseUrl: 'http://vetlink.test',
        channel: 'app',
        getAccessToken: () => token,
        fetch: async (request: Request) => {
          const url = new URL(request.url);
          const body = request.body ? await request.text() : undefined;
          const res = await h.app.inject({
            method: request.method as 'GET',
            url: url.pathname + url.search,
            headers: Object.fromEntries(request.headers.entries()),
            ...(body !== undefined && { payload: body }),
          });
          return new Response(res.statusCode === 204 ? null : res.body, {
            status: res.statusCode,
            headers: res.headers as Record<string, string>,
          });
        },
      });
    }

    it('onboards a farmer through the typed client: consent, role, farm, animal, booking', async () => {
      const s = await h.login();
      const api = client(s.accessToken);

      const before = await api.GET('/v1/me');
      expect(before.data?.onboarding).toEqual({ consented: false, roleChosen: false });

      const early = await api.POST('/v1/me/roles', { body: { role: 'farmer' } });
      expect(early.error?.code).toBe('consent_required');

      await api.POST('/v1/me/consent');
      const named = await api.PATCH('/v1/me', { body: { name: 'Wanjiku', language: 'en' } });
      expect(named.data).toMatchObject({ name: 'Wanjiku', language: 'en' });
      const chosen = await api.POST('/v1/me/roles', { body: { role: 'farmer' } });
      expect(chosen.data).toMatchObject({
        roles: ['farmer'],
        onboarding: { consented: true, roleChosen: true },
      });

      const farm = await api.PUT('/v1/farmers/me', {
        body: { wardId, farmNotes: 'Behind the church', farmLat: -1.05, farmLng: 36.9 },
      });
      expect(farm.data).toMatchObject({ ward: { id: wardId }, farmNotes: 'Behind the church' });

      const cow = await api.POST('/v1/animals', {
        body: { species: 'cattle', nameOrTag: 'Daisy', sex: 'female', dob: '2023-04-01' },
      });
      expect(cow.response.status).toBe(201);
      const animalId = cow.data?.id ?? '';

      const booking = await api.POST('/v1/bookings', {
        params: { header: { 'idempotency-key': 'client-test-key-0001' } },
        body: { species: 'cattle', problemType: 'sick', animalId },
      });
      expect(booking.response.status).toBe(201);
      expect(booking.data).toMatchObject({ status: 'pending_payment', sourceChannel: 'app' });

      const history = await api.GET('/v1/animals/{id}/history', {
        params: { path: { id: animalId } },
      });
      expect(history.data?.animal.nameOrTag).toBe('Daisy');
      expect(history.data?.visits.map((v) => v.status)).toEqual(['pending_payment']);
    });

    it('choosing vet starts a draft vet; admin can never be chosen', async () => {
      const s = await h.login();
      await h.post('/v1/me/consent', {}, s.accessToken);
      const res = await h.post('/v1/me/roles', { role: 'vet', vetType: 'paravet' }, s.accessToken);
      expect(res.json()).toMatchObject({ roles: ['vet'], vet: { verificationStatus: 'draft' } });
      const admin = await h.post('/v1/me/roles', { role: 'admin' }, s.accessToken);
      expect(admin.statusCode).toBe(400);
      expect(admin.json()).toMatchObject({
        code: 'invalid_request',
        details: { fields: ['role'] },
      });
      // Choosing again is harmless.
      expect(
        (await h.post('/v1/me/roles', { role: 'vet', vetType: 'paravet' }, s.accessToken))
          .statusCode,
      ).toBe(200);
    });

    it('animals are private to their farmer', async () => {
      const a = await h.farmer(wardId);
      const b = await h.farmer(wardId);
      const cow = (await h.post('/v1/animals', { species: 'goat' }, a.accessToken)).json<{
        id: string;
      }>();
      expect((await h.get(`/v1/animals/${cow.id}/history`, b.accessToken)).statusCode).toBe(404);
      expect((await h.get('/v1/animals', b.accessToken)).json()).toEqual([]);
      expect(errorCode(await h.post('/v1/animals', { species: 'unicorn' }, a.accessToken))).toBe(
        'invalid_request',
      );
    });

    it('ward lists and the minimum app version are public', async () => {
      await h.ward('Kamwangi');
      const counties = await h.get('/v1/locations/counties');
      expect(counties.json()).toContain('Testcounty');
      const wards = await h.get('/v1/locations/wards?county=Testcounty');
      expect(wards.json<{ ward: string }[]>().map((w) => w.ward)).toContain('Kamwangi');
      expect((await h.get('/v1/meta/min-app-version')).json()).toEqual({ minVersion: '1.0.0' });
    });

    it('a farm pin outside Kenya is rejected; the ward must exist', async () => {
      const f = await h.farmer(wardId);
      const res = await h.request('PUT', '/v1/farmers/me', {
        token: f.accessToken,
        body: { wardId, farmLat: 51.5, farmLng: -0.1 },
      });
      expect(res.json()).toMatchObject({
        code: 'invalid_request',
        details: { fields: ['farmLat', 'farmLng'] },
      });
      const bad = await h.request('PUT', '/v1/farmers/me', {
        token: f.accessToken,
        body: { wardId: 999_999 },
      });
      expect(errorCode(bad)).toBe('invalid_request');
    });
  },
);
