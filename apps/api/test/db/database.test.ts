import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type DbHandle } from '../../src/db/client.js';
import { assertNoDevSeedData } from '../../src/db/dev-seed-guard.js';
import { runMigrations } from '../../src/db/migrate.js';
import { SEED_USERS } from '../../src/db/seed/fixtures.js';
import { seed } from '../../src/db/seed/seed.js';
import { fieldCrypto } from '../../src/lib/crypto.js';

// Each run gets a throwaway database on the TEST_DATABASE_URL server: migrated from empty,
// seeded, and dropped afterwards. Never touches the dev database's data.
const serverUrl = process.env.TEST_DATABASE_URL;
const crypto = fieldCrypto(Buffer.alloc(32, 3).toString('base64'));
// CREATE DATABASE plus the first migration is fsync-heavy: ~12s on a WSL2 Docker volume.
const SETUP_TIMEOUT_MS = 60_000;

const EXPECTED_TABLES = [
  'admin_profiles',
  'animals',
  'audit_log',
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

  it('stores vet national IDs and the admin TOTP secret encrypted', async () => {
    const [vet] = await h.sql`select national_id_enc, national_id_hash, verification_status
      from vets where user_id = ${SEED_USERS.approvedVet.id}`;
    expect(vet?.verification_status).toBe('approved');
    expect(vet?.national_id_enc).toMatch(/^v1\./);
    expect(crypto.decrypt(vet?.national_id_enc as string)).toBe('00000002');
    expect(vet?.national_id_hash).toBe(crypto.lookupHash('00000002'));

    const [adminRow] = await h.sql`select admin_role, totp_secret_enc from admin_profiles`;
    expect(adminRow?.admin_role).toBe('super_admin');
    expect(adminRow?.totp_secret_enc).toMatch(/^v1\./);
  });

  it('only the approved, available vet matches the matching index predicate', async () => {
    const rows = await h.sql`select user_id from vets
      where verification_status = 'approved' and is_available`;
    expect(rows.map((r) => r.user_id)).toEqual([SEED_USERS.approvedVet.id]);
  });

  it('fails production startup when seed accounts exist, and only in production', async () => {
    await expect(assertNoDevSeedData('production', url)).rejects.toThrow(/Dev seed accounts/);
    await expect(assertNoDevSeedData('staging', url)).resolves.toBeUndefined();
  });

  describe('constraints', () => {
    const rejects = (query: () => Promise<unknown>) => expect(query()).rejects.toThrow();

    it('rejects malformed phone numbers, languages, and roles', async () => {
      await rejects(() => h.sql`insert into users (phone) values ('0712345678')`);
      await rejects(() => h.sql`insert into users (phone, language) values ('254711111111', 'fr')`);
      await rejects(
        () => h.sql`insert into users (phone, roles) values ('254711111112', '{farmer,root}')`,
      );
      await rejects(
        () => h.sql`insert into users (phone) values (${SEED_USERS.farmer.phone})`, // unique
      );
    });

    it('rejects unknown statuses and enum values', async () => {
      await rejects(
        () => h.sql`update vets set verification_status = 'verified'
          where user_id = ${SEED_USERS.pendingVet.id}`,
      );
      await rejects(
        () => h.sql`insert into admin_profiles (user_id, admin_role)
          values (${SEED_USERS.farmer.id}, 'owner')`,
      );
    });

    it('enforces booking status, offer uniqueness, idempotency keys, and rating range', async () => {
      const [ward] = await h.sql`select id from locations limit 1`;
      const insertBooking = (key: string, status = 'pending_payment') => h.sql`
        insert into bookings (farmer_id, species, problem_type, source_channel, ward_id,
          fee_quoted, idempotency_key, status)
        values (${SEED_USERS.farmer.id}, 'cattle', 'not_eating', 'ussd', ${ward?.id as number},
          500, ${key}, ${status})
        returning id`;

      await rejects(() => insertBooking('k-bad-status', 'accepted'));
      const [booking] = await insertBooking('k-1');
      await rejects(() => insertBooking('k-1')); // duplicate idempotency key

      const offer = () => h.sql`insert into booking_offers (booking_id, vet_id, wave, channel)
        values (${booking?.id as number}, ${SEED_USERS.approvedVet.id}, 1, 'push')`;
      await offer();
      await rejects(offer); // one offer per vet per booking

      await rejects(
        () => h.sql`insert into ratings (booking_id, stars) values (${booking?.id as number}, 6)`,
      );
      await rejects(
        () => h.sql`insert into payments (booking_id, type, amount)
          values (${booking?.id as number}, 'tip', 100)`,
      );
    });
  });
});
