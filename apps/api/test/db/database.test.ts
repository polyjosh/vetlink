import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type DbHandle } from '../../src/db/client.js';
import { assertNoDevSeedData, watchForDevSeedData } from '../../src/db/dev-seed-guard.js';
import { runMigrations } from '../../src/db/migrate.js';
import { SEED_USERS } from '../../src/db/seed/fixtures.js';
import { seed } from '../../src/db/seed/seed.js';
import { fieldContext, fieldCrypto } from '../../src/lib/crypto.js';

// Each run gets a throwaway database on the TEST_DATABASE_URL server: migrated from empty,
// seeded, and dropped afterwards. Never touches the dev database's data.
const serverUrl = process.env.TEST_DATABASE_URL;
// CI must never skip these silently.
if (process.env.CI && !serverUrl) throw new Error('TEST_DATABASE_URL must be set in CI');
const crypto = fieldCrypto(Buffer.alloc(32, 3).toString('base64'));
// CREATE DATABASE plus the first migration is fsync-heavy: ~12s on a WSL2 Docker volume.
const SETUP_TIMEOUT_MS = 60_000;

const EXPECTED_TABLES = [
  'admin_profiles',
  'animals',
  'audit_log',
  'auth_sessions',
  'booking_offers',
  'bookings',
  'devices',
  'farmers',
  'locations',
  'media',
  'notifications',
  'otp_codes',
  'payments',
  'ratings',
  'refresh_tokens',
  'reminders',
  'treatments',
  'users',
  'ussd_sessions',
  'vet_applications',
  'vet_documents',
  'vets',
];

describe.skipIf(!serverUrl)('database (migrations, seed, constraints)', () => {
  const dbName = `vetlink_test_${randomBytes(4).toString('hex')}`;
  let admin: postgres.Sql;
  let url: string;
  let h: DbHandle;

  beforeAll(async () => {
    admin = postgres(serverUrl ?? '', { max: 1, onnotice: () => {} });
    await admin.unsafe(`create database ${dbName}`);
    const u = new URL(serverUrl ?? '');
    u.pathname = `/${dbName}`;
    url = u.toString();
    await runMigrations(url);
    h = createDb(url, { max: 2 });
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await h?.close();
    await admin?.unsafe(`drop database if exists ${dbName} with (force)`);
    await admin?.end();
  }, SETUP_TIMEOUT_MS);

  it('creates every table from an empty database', async () => {
    const rows = await h.sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public' order by table_name`;
    expect(rows.map((r) => r.table_name)).toEqual(EXPECTED_TABLES);
  });

  it('re-running migrations is a no-op', async () => {
    await expect(runMigrations(url)).resolves.toBeUndefined();
  });

  it('seeds twice without errors or duplicates', async () => {
    await seed(h.db, crypto);
    const counts = async () =>
      (
        await h.sql<{ t: string; n: number }[]>`
          select 'locations' t, count(*)::int n from locations
          union all select 'users', count(*)::int from users
          union all select 'vets', count(*)::int from vets
          union all select 'vet_applications', count(*)::int from vet_applications
          union all select 'admin_profiles', count(*)::int from admin_profiles
          union all select 'animals', count(*)::int from animals`
      ).map((r) => `${r.t}=${r.n}`);
    const first = await counts();
    await seed(h.db, crypto);
    expect(await counts()).toEqual(first);
    expect(first).toEqual([
      'locations=60',
      'users=4',
      'vets=2',
      'vet_applications=2',
      'admin_profiles=1',
      'animals=1',
    ]);
  });

  it('applies every committed migration', async () => {
    const [row] = await h.sql`select count(*)::int n from drizzle.__drizzle_migrations`;
    const journal = JSON.parse(
      readFileSync(new URL('../../src/db/migrations/meta/_journal.json', import.meta.url), 'utf8'),
    ) as { entries: unknown[] };
    expect(journal.entries.length).toBeGreaterThanOrEqual(3);
    expect(row?.n).toBe(journal.entries.length);
  });

  it('stores vet national IDs and the admin TOTP secret encrypted and bound to their row', async () => {
    const [vet] = await h.sql`select national_id_enc, national_id_hash, verification_status
      from vets where user_id = ${SEED_USERS.approvedVet.id}`;
    const nationalIdEnc = vet?.national_id_enc as string;
    expect(vet?.verification_status).toBe('approved');
    expect(nationalIdEnc).toMatch(/^v1\./);
    const ctx = fieldContext('vets.national_id', SEED_USERS.approvedVet.id);
    expect(crypto.decrypt(nationalIdEnc, ctx)).toBe('00000002');
    expect(vet?.national_id_hash).toBe(crypto.lookupHash('00000002'));
    // Copied onto another vet's row, the value no longer decrypts.
    const otherCtx = fieldContext('vets.national_id', SEED_USERS.pendingVet.id);
    expect(() => crypto.decrypt(nationalIdEnc, otherCtx)).toThrow();

    const [adminRow] = await h.sql`select admin_role, totp_secret_enc from admin_profiles`;
    expect(adminRow?.admin_role).toBe('super_admin');
    expect(adminRow?.totp_secret_enc).toMatch(/^v1\./);
  });

  it('never stores admin in users.roles; admin comes from admin_profiles', async () => {
    const [u] = await h.sql`select roles from users where id = ${SEED_USERS.admin.id}`;
    expect(u?.roles).toEqual([]);
  });

  it('only the approved, available vet matches the matching index predicate', async () => {
    const rows = await h.sql`select user_id from vets
      where verification_status = 'approved' and is_available`;
    expect(rows.map((r) => r.user_id)).toEqual([SEED_USERS.approvedVet.id]);
  });

  describe('dev seed guard', () => {
    it('fails production startup when seed accounts exist, and only in production', async () => {
      await expect(assertNoDevSeedData('production', url)).rejects.toThrow(/Dev seed accounts/);
      await expect(assertNoDevSeedData('staging', url)).resolves.toBeUndefined();
    });

    it('matches a seed account by fixed ID even if its phone was changed', async () => {
      // Move every seed phone off the demo range; the rows keep their fixed seed IDs.
      await h.sql`update users set phone = '25479999999' || right(phone, 1)`;
      try {
        const [hit] = await h.sql`select count(*)::int n from users where phone like '2547000000%'`;
        expect(hit?.n).toBe(0);
        await expect(assertNoDevSeedData('production', url)).rejects.toThrow(/Dev seed accounts/);
      } finally {
        await h.sql`update users set phone = '25470000000' || right(phone, 1)`;
      }
    });

    it('a running production process detects seed data written after startup', async () => {
      let errors = 0;
      const found = new Promise<void>((resolve) => {
        const stop = watchForDevSeedData({
          appEnv: 'production',
          databaseUrl: url,
          intervalMs: 10,
          onFound: () => {
            void stop().then(resolve);
          },
          onError: () => {
            errors += 1;
          },
        });
      });
      await expect(found).resolves.toBeUndefined();
      expect(errors).toBe(0);
    });
  });

  describe('constraints', () => {
    /** Fails unless the query is rejected by exactly this constraint (not some other error). */
    const rejectsWith = async (constraint: string, query: () => Promise<unknown>) => {
      await expect(query()).rejects.toMatchObject({ constraint_name: constraint });
    };

    it('rejects malformed phone numbers, languages, and roles', async () => {
      await rejectsWith(
        'users_phone_check',
        () => h.sql`insert into users (phone) values ('0712345678')`,
      );
      await rejectsWith('users_phone_check', () => h.sql`insert into users (phone) values (null)`);
      await rejectsWith(
        'users_language_check',
        () => h.sql`insert into users (phone, language) values ('254711111111', 'fr')`,
      );
      await rejectsWith(
        'users_roles_check',
        () => h.sql`insert into users (phone, roles) values ('254711111112', '{farmer,root}')`,
      );
      await rejectsWith(
        'users_roles_check',
        () => h.sql`insert into users (phone, roles) values ('254711111113', '{admin}')`,
      );
      await rejectsWith(
        'users_phone_active_key',
        () => h.sql`insert into users (phone) values (${SEED_USERS.farmer.phone})`,
      );
    });

    it('lets account deletion anonymize the phone and frees the number for a new account', async () => {
      await h.sql
        .begin(async (tx) => {
          const [u] = await tx`insert into users (phone) values ('254722222222') returning id`;
          // Soft-deleted but not yet anonymized: the number may sign up again.
          await tx`update users set deleted_at = now() where id = ${u?.id as string}`;
          await tx`insert into users (phone) values ('254722222222')`;
          // The anonymize job clears the phone.
          await tx`update users set phone = null where id = ${u?.id as string}`;
          throw new Error('rollback');
        })
        .catch((err: unknown) => {
          if (!(err instanceof Error) || err.message !== 'rollback') throw err;
        });
    });

    it('rejects unknown statuses and enum values', async () => {
      await rejectsWith(
        'vets_verification_status_check',
        () => h.sql`update vets set verification_status = 'verified'
          where user_id = ${SEED_USERS.pendingVet.id}`,
      );
      await rejectsWith(
        'admin_profiles_admin_role_check',
        () => h.sql`insert into admin_profiles (user_id, admin_role)
          values (${SEED_USERS.farmer.id}, 'owner')`,
      );
      await rejectsWith(
        'media_kind_check',
        () => h.sql`insert into media (owner_user_id, storage_key, kind)
          values (${SEED_USERS.farmer.id}, 'k', 'selfie')`,
      );
    });

    it('an unapproved vet can never be online (invariant 2)', async () => {
      await rejectsWith(
        'vets_available_requires_approved',
        () =>
          h.sql`update vets set is_available = true where user_id = ${SEED_USERS.pendingVet.id}`,
      );
      // Suspending an online vet without taking them offline is rejected too.
      await rejectsWith(
        'vets_available_requires_approved',
        () => h.sql`update vets set verification_status = 'suspended'
          where user_id = ${SEED_USERS.approvedVet.id}`,
      );
      await rejectsWith(
        'vets_rating_check',
        () => h.sql`update vets set rating = 0.5 where user_id = ${SEED_USERS.approvedVet.id}`,
      );
    });

    it('enforces booking status, offer uniqueness, idempotency keys, and rating range', async () => {
      const [ward] = await h.sql`select id from locations limit 1`;
      const insertBooking = (key: string, status = 'pending_payment', fee = 500) => h.sql`
        insert into bookings (farmer_id, species, problem_type, source_channel, ward_id,
          fee_quoted, idempotency_key, status)
        values (${SEED_USERS.farmer.id}, 'cattle', 'not_eating', 'ussd', ${ward?.id as number},
          ${fee}, ${key}, ${status})
        returning id`;

      await rejectsWith('bookings_status_check', () => insertBooking('k-bad-status', 'accepted'));
      await rejectsWith('bookings_fee_quoted_check', () =>
        insertBooking('k-neg', 'pending_payment', -1),
      );
      const [booking] = await insertBooking('k-1');
      await rejectsWith('bookings_idempotency_key_unique', () => insertBooking('k-1'));

      const offer = () => h.sql`insert into booking_offers (booking_id, vet_id, wave, channel)
        values (${booking?.id as number}, ${SEED_USERS.approvedVet.id}, 1, 'push')`;
      await offer();
      await rejectsWith('booking_offers_booking_id_vet_id_key', offer);

      await rejectsWith(
        'ratings_stars_check',
        () => h.sql`insert into ratings (booking_id, stars) values (${booking?.id as number}, 6)`,
      );
      await rejectsWith(
        'payments_type_check',
        () => h.sql`insert into payments (booking_id, type, amount)
          values (${booking?.id as number}, 'tip', 100)`,
      );
      await rejectsWith(
        'payments_amount_check',
        () => h.sql`insert into payments (booking_id, type, amount)
          values (${booking?.id as number}, 'refund', -100)`,
      );
    });
  });
});
