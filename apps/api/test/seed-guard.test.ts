import { describe, expect, it } from 'vitest';
import { assertNoDevSeedData } from '../src/db/dev-seed-guard.js';
import { SEED_PHONES } from '../src/db/seed/fixtures.js';
import { assertSeedAllowed } from '../src/db/seed/seed.js';

describe('assertSeedAllowed', () => {
  it.each(['development', 'test'] as const)('allows %s', (env) => {
    expect(() => assertSeedAllowed(env)).not.toThrow();
  });

  it.each(['staging', 'production'] as const)('refuses %s', (env) => {
    expect(() => assertSeedAllowed(env)).toThrow(/Refusing to seed/);
  });
});

describe('assertNoDevSeedData', () => {
  it('does not touch the database outside production', async () => {
    // An unreachable URL proves no connection is attempted.
    await expect(
      assertNoDevSeedData('development', 'postgres://x:y@127.0.0.1:1/none'),
    ).resolves.toBeUndefined();
  });
});

describe('seed fixtures', () => {
  it('use only obviously fake 2547000000xx numbers', () => {
    for (const phone of SEED_PHONES) expect(phone).toMatch(/^2547000000\d{2}$/);
  });
});
