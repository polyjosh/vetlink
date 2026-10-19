import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MeResponse } from '@vetlink/shared';
import { auditLog, media, notifications, users, vets } from '../../src/db/schema/index.js';
import { Harness, errorCode, type Session } from '../helpers/harness.js';
import {
  createTestDatabase,
  DB_SETUP_TIMEOUT_MS,
  testServerUrl,
  type TestDatabase,
} from '../helpers/test-db.js';

interface AnimalView {
  id: string;
  species: string;
  nameOrTag: string | null;
  photoUrl: string | null;
}

describe.skipIf(!testServerUrl)('profiles and photos (database)', { timeout: 60_000 }, () => {
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

  const presign = (s: Session, photoKind: string, size = 80_000, contentType = 'image/jpeg') =>
    h.post(
      '/v1/uploads/presign',
      { purpose: 'photo', photoKind, contentType, size },
      s.accessToken,
    );

  /** Presign and "upload" the way the app does; returns the storage key. */
  async function uploaded(s: Session, kind: 'avatar' | 'animal_photo', size = 80_000) {
    const res = await presign(s, kind, size);
    expect(res.statusCode).toBe(200);
    const { storageKey } = res.json<{ storageKey: string }>();
    h.storage.put(storageKey, size, 'image/jpeg');
    return storageKey;
  }

  const setAvatar = (s: Session, storageKey: string) =>
    h.request('PUT', '/v1/me/avatar', { token: s.accessToken, body: { storageKey } });
  const me = async (s: Session) => (await h.get('/v1/me', s.accessToken)).json<MeResponse>();

  describe('uploads', () => {
    it('refuses oversized photos, and kinds the caller may not upload', async () => {
      const farmer = await h.farmer(wardId);
      expect(errorCode(await presign(farmer, 'avatar', 600_000))).toBe('photo_invalid');
      expect((await presign(farmer, 'avatar', 80_000, 'application/pdf')).statusCode).toBe(400);
      const vet = await h.vet(wardId);
      expect(errorCode(await presign(vet, 'animal_photo'))).toBe('forbidden');
      // Vet documents stay vet-only.
      expect(
        errorCode(
          await h.post(
            '/v1/uploads/presign',
            {
              purpose: 'vet_document',
              documentKind: 'licence',
              contentType: 'image/jpeg',
              size: 1000,
            },
            farmer.accessToken,
          ),
        ),
      ).toBe('forbidden');
    });

    it('checks the uploaded object: owner, presence, type and size', async () => {
      const a = await h.farmer(wardId);
      const b = await h.farmer(wardId);
      const key = await uploaded(a, 'avatar');
      expect(errorCode(await setAvatar(b, key))).toBe('photo_invalid'); // not b's key

      const missing = (await presign(a, 'avatar')).json<{ storageKey: string }>().storageKey;
      expect(errorCode(await setAvatar(a, missing))).toBe('photo_invalid');

      const wrong = (await presign(a, 'avatar')).json<{ storageKey: string }>().storageKey;
      h.storage.put(wrong, 80_000, 'text/html'); // the client lied about the type
      expect(errorCode(await setAvatar(a, wrong))).toBe('photo_invalid');
      expect(h.storage.objects.has(wrong)).toBe(false);

      const big = (await presign(a, 'avatar')).json<{ storageKey: string }>().storageKey;
      h.storage.put(big, 900_000, 'image/jpeg');
      expect(errorCode(await setAvatar(a, big))).toBe('photo_invalid');
    });
  });

  describe('farmer profile', () => {
    it("a farmer's photo is live at once; replacing or removing it deletes the old one", async () => {
      const farmer = await h.farmer(wardId);
      expect((await me(farmer)).photo).toEqual({ url: null, review: null });

      const first = await uploaded(farmer, 'avatar');
      const res = await setAvatar(farmer, first);
      expect(res.statusCode).toBe(200);
      expect(res.json<MeResponse>().photo.url).toContain(encodeURIComponent(first));
      // A retry of the same confirmation is harmless.
      expect((await setAvatar(farmer, first)).statusCode).toBe(200);
      expect(
        await h.db.select().from(media).where(eq(media.ownerUserId, farmer.userId)),
      ).toHaveLength(1);

      const second = await uploaded(farmer, 'avatar');
      await setAvatar(farmer, second);
      expect((await me(farmer)).photo.url).toContain(encodeURIComponent(second));
      expect(h.storage.objects.has(first)).toBe(false);

      const removed = await h.request('DELETE', '/v1/me/avatar', { token: farmer.accessToken });
      expect(removed.json<MeResponse>().photo.url).toBeNull();
      expect(h.storage.objects.has(second)).toBe(false);
      expect(
        await h.db.select().from(media).where(eq(media.ownerUserId, farmer.userId)),
      ).toHaveLength(0);
    });

    it('username: display only, validated, clearable; theme is saved', async () => {
      const farmer = await h.farmer(wardId);
      const patch = (body: object) =>
        h.request('PATCH', '/v1/me', { token: farmer.accessToken, body });

      const ok = await patch({ displayName: "  Mama Ng'ombe 2 ", theme: 'dark' });
      expect(errorCode(ok)).toBe('invalid_request'); // apostrophe is not allowed
      const set = await patch({ displayName: '  Mama Wanjiku_2 ', theme: 'dark' });
      expect(set.json<MeResponse>()).toMatchObject({
        displayName: 'Mama Wanjiku_2',
        theme: 'dark',
      });

      for (const bad of ['ab', 'Call 0712345678', 'shop.co.ke', 'x'.repeat(31)]) {
        expect(errorCode(await patch({ displayName: bad }))).toBe('invalid_request');
      }
      expect(errorCode(await patch({ theme: 'neon' }))).toBe('invalid_request');
      expect((await patch({ displayName: null })).json<MeResponse>().displayName).toBeNull();
      // The login identity is untouched.
      expect((await me(farmer)).phone).toBe(farmer.phone);
    });
  });

  describe('animal photos', () => {
    it('set, list, replace and remove; only the owner can', async () => {
      const farmer = await h.farmer(wardId);
      const other = await h.farmer(wardId);
      const cow = (
        await h.post('/v1/animals', { species: 'cattle', nameOrTag: 'Daisy' }, farmer.accessToken)
      ).json<AnimalView>();
      expect(cow.photoUrl).toBeNull(); // clients show the species picture

      const key = await uploaded(farmer, 'animal_photo');
      const put = (s: Session, storageKey: string) =>
        h.request('PUT', `/v1/animals/${cow.id}/photo`, {
          token: s.accessToken,
          body: { storageKey },
        });
      expect(errorCode(await put(other, await uploaded(other, 'animal_photo')))).toBe('not_found');
      const res = await put(farmer, key);
      expect(res.json<AnimalView>().photoUrl).toContain(encodeURIComponent(key));
      expect((await put(farmer, key)).statusCode).toBe(200); // retry

      const list = (await h.get('/v1/animals', farmer.accessToken)).json<AnimalView[]>();
      expect(list[0]?.photoUrl).toContain(encodeURIComponent(key));

      const next = await uploaded(farmer, 'animal_photo');
      await put(farmer, next);
      expect(h.storage.objects.has(key)).toBe(false);

      expect(
        errorCode(
          await h.request('DELETE', `/v1/animals/${cow.id}/photo`, { token: other.accessToken }),
        ),
      ).toBe('not_found');
      const removed = await h.request('DELETE', `/v1/animals/${cow.id}/photo`, {
        token: farmer.accessToken,
      });
      expect(removed.json<AnimalView>().photoUrl).toBeNull();
      expect(h.storage.objects.has(next)).toBe(false);
    });

    it('edits an animal; the species is fixed and other farmers get not_found', async () => {
      const farmer = await h.farmer(wardId);
      const other = await h.farmer(wardId);
      const goat = (
        await h.post('/v1/animals', { species: 'goat', nameOrTag: 'Kid' }, farmer.accessToken)
      ).json<AnimalView>();
      const patch = (s: Session, body: object) =>
        h.request('PATCH', `/v1/animals/${goat.id}`, { token: s.accessToken, body });
      expect((await patch(farmer, { nameOrTag: 'Billy', breed: 'Galla' })).json()).toMatchObject({
        nameOrTag: 'Billy',
        breed: 'Galla',
        species: 'goat',
      });
      expect((await patch(farmer, { breed: null })).json()).toMatchObject({ breed: null });
      expect(errorCode(await patch(other, { nameOrTag: 'Mine' }))).toBe('not_found');
      expect(errorCode(await patch(farmer, {}))).toBe('invalid_request');
    });
  });

  describe('vet photo review', () => {
    /** An approved vet with a verified photo already live. */
    async function vetWithPhoto() {
      const vet = await h.vet(wardId);
      const [row] = await h.db
        .insert(media)
        .values({
          ownerUserId: vet.userId,
          storageKey: `media/${vet.userId}/avatar-verified.jpg`,
          kind: 'avatar',
          reviewStatus: 'approved',
          createdAt: h.now,
        })
        .returning();
      h.storage.put(row?.storageKey ?? '', 50_000, 'image/jpeg');
      await h.db.update(users).set({ avatarMediaId: row?.id }).where(eq(users.id, vet.userId));
      h.advance(60_000); // later uploads are newer
      return { vet, liveKey: row?.storageKey ?? '' };
    }

    it('a new photo waits for a verifier; farmers keep seeing the approved one', async () => {
      const { vet, liveKey } = await vetWithPhoto();
      const key = await uploaded(vet, 'avatar');
      const res = await setAvatar(vet, key);
      expect(res.json<MeResponse>().photo).toEqual({
        url: expect.stringContaining(encodeURIComponent(liveKey)),
        review: { status: 'pending', url: expect.stringContaining(encodeURIComponent(key)) },
      });

      // A second change replaces the pending one.
      const newer = await uploaded(vet, 'avatar');
      await setAvatar(vet, newer);
      expect(h.storage.objects.has(key)).toBe(false);

      const verifier = await h.admin('verifier');
      const support = await h.admin('support');
      const farmer = await h.farmer(wardId);
      expect(errorCode(await h.get('/v1/admin/vet-photos', support.accessToken))).toBe('not_found');
      expect(errorCode(await h.get('/v1/admin/vet-photos', farmer.accessToken))).toBe('not_found');
      const queue = (await h.get('/v1/admin/vet-photos', verifier.accessToken)).json<
        { mediaId: string; vetUserId: string; pendingUrl: string; currentUrl: string }[]
      >();
      expect(queue).toHaveLength(1);
      expect(queue[0]).toMatchObject({ vetUserId: vet.userId });
      expect(queue[0]?.currentUrl).toContain(encodeURIComponent(liveKey));

      const decide = (body: object) =>
        h.post(`/v1/admin/vet-photos/${queue[0]?.mediaId}/decision`, body, verifier.accessToken);
      expect((await decide({ decision: 'approve' })).statusCode).toBe(204);
      expect(errorCode(await decide({ decision: 'approve' }))).toBe('invalid_transition');

      const after = await me(vet);
      expect(after.photo).toEqual({
        url: expect.stringContaining(encodeURIComponent(newer)),
        review: null,
      });
      expect(h.storage.objects.has(liveKey)).toBe(false);
      const audits = await h.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.entityId, queue[0]?.mediaId ?? ''));
      expect(audits.map((a) => a.action)).toEqual(['vet_photo.approved']);
      const sent = await h.db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, vet.userId));
      expect(sent.map((n) => n.kind)).toContain('photo_approved');
    });

    it('a rejected photo is deleted and the vet sees why', async () => {
      const { vet, liveKey } = await vetWithPhoto();
      const key = await uploaded(vet, 'avatar');
      await setAvatar(vet, key);
      const verifier = await h.admin('verifier');
      const [item] = (await h.get('/v1/admin/vet-photos', verifier.accessToken)).json<
        { mediaId: string }[]
      >();
      expect(
        errorCode(
          await h.post(
            `/v1/admin/vet-photos/${item?.mediaId}/decision`,
            { decision: 'reject' },
            verifier.accessToken,
          ),
        ),
      ).toBe('invalid_request'); // a reason is required
      await h.post(
        `/v1/admin/vet-photos/${item?.mediaId}/decision`,
        { decision: 'reject', reason: 'face_not_clear' },
        verifier.accessToken,
      );
      expect((await me(vet)).photo).toEqual({
        url: expect.stringContaining(encodeURIComponent(liveKey)),
        review: { status: 'rejected', reason: 'face_not_clear' },
      });
      expect(h.storage.objects.has(key)).toBe(false);
      const [v] = await h.db.select().from(vets).where(eq(vets.userId, vet.userId));
      expect(v?.pendingAvatarMediaId).toBeNull();
    });

    it('a vet can withdraw a pending photo but never remove the verified one', async () => {
      const { vet } = await vetWithPhoto();
      const del = () => h.request('DELETE', '/v1/me/avatar', { token: vet.accessToken });
      expect(errorCode(await del())).toBe('vet_photo_required');
      await setAvatar(vet, await uploaded(vet, 'avatar'));
      const res = await del();
      expect(res.statusCode).toBe(200);
      expect(res.json<MeResponse>().photo.review).toBeNull();
      expect(res.json<MeResponse>().photo.url).not.toBeNull();
    });
  });
});
