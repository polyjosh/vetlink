import { describe, expect, it } from 'vitest';
import { assertNoDevSeedData, watchForDevSeedData } from '../src/db/dev-seed-guard.js';
import { SEED_PHONES } from '../src/db/seed/fixtures.js';
import { assertSeedAllowed } from '../src/db/seed/seed.js';

const local = 'postgres://u:p@localhost:5432/vetlink';

describe('assertSeedAllowed', () => {
  it.each(['development', 'test'] as const)('allows %s on a local database', (env) => {
    expect(() => assertSeedAllowed(env, local)).not.toThrow();
  });

  it.each(['staging', 'production'] as const)('refuses %s even on a local database', (env) => {
    expect(() => assertSeedAllowed(env, local)).toThrow(/Refusing to seed with APP_ENV/);
  });

  it.each([
    'postgres://u:p@localhost:5432/x',
    'postgres://u:p@127.0.0.1:5432/x',
    'postgres://u:p@[::1]:5432/x',
    'postgres://u:p@db:5432/x',
  ])('allows local host %s', (url) => {
    expect(() => assertSeedAllowed('development', url)).not.toThrow();
  });

  it.each([
    'postgres://u:secretpw@prod-db.example.com:5432/vetlink',
    'postgres://u:secretpw@10.0.0.5:5432/vetlink',
    'postgres://u:secretpw@localhost.attacker.example:5432/vetlink',
  ])('refuses non-local host %s in development, without echoing credentials', (url) => {
    const run = () => assertSeedAllowed('development', url);
    expect(run).toThrow(/non-local database host/);
    expect(run).not.toThrow(/secretpw/);
  });

  it('refuses an unparseable DATABASE_URL', () => {
    expect(() => assertSeedAllowed('development', 'not a url')).toThrow(/not a valid URL/);
  });
});

describe('dev seed guard outside production', () => {
  // An unreachable URL proves no connection is attempted.
  const unreachable = 'postgres://x:y@127.0.0.1:1/none';

  it('startup check does not touch the database', async () => {
    await expect(assertNoDevSeedData('development', unreachable)).resolves.toBeUndefined();
  });

  it('watch is a no-op', async () => {
    const stop = watchForDevSeedData({
      appEnv: 'staging',
      databaseUrl: unreachable,
      onFound: () => {
        throw new Error('must not be called');
      },
      onError: () => {
        throw new Error('must not be called');
      },
      intervalMs: 1,
    });
    await new Promise((r) => setTimeout(r, 20));
    await stop();
  });
});

describe('seed fixtures', () => {
  it('use only the 2547000000xx demo range', () => {
    for (const phone of SEED_PHONES) expect(phone).toMatch(/^2547000000\d{2}$/);
  });
});
