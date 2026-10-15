import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { memoryCounters, redisCounters, type Counters } from '../src/lib/counters.js';

function contract(
  name: string,
  make: () => { counters: Counters; advance: (ms: number) => Promise<void> },
  // Real Redis expires keys in real time; keep windows wide enough not to flake under load.
  w = 200,
) {
  describe(name, () => {
    it('counts hits within a window and expires them', async () => {
      const { counters, advance } = make();
      const key = `t:${Math.random()}`;
      expect(await counters.hit(key, w)).toBe(1);
      expect(await counters.hit(key, w)).toBe(2);
      expect(await counters.get(key)).toBe(2);
      await advance(w * 1.5);
      expect(await counters.get(key)).toBe(0);
      expect(await counters.hit(key, w)).toBe(1);
    });

    it('resets a key', async () => {
      const { counters } = make();
      const key = `t:${Math.random()}`;
      await counters.hit(key, 10_000);
      await counters.reset(key);
      expect(await counters.get(key)).toBe(0);
    });

    it('claims a key once until it expires', async () => {
      const { counters, advance } = make();
      const key = `t:${Math.random()}`;
      expect(await counters.claim(key, w)).toBe(true);
      expect(await counters.claim(key, w)).toBe(false);
      await advance(w * 1.5);
      expect(await counters.claim(key, w)).toBe(true);
    });
  });
}

let fakeNow = 0;
contract('memoryCounters', () => ({
  counters: memoryCounters(() => new Date(fakeNow)),
  advance: async (ms) => {
    fakeNow += ms;
  },
}));

// Redis-backed: needs TEST_REDIS_URL (set in CI). Uses a dedicated logical DB.
const redisUrl = process.env.TEST_REDIS_URL;
if (process.env.CI && !redisUrl) throw new Error('TEST_REDIS_URL must be set in CI');
describe.skipIf(!redisUrl)('redis', () => {
  let redis: Redis;
  beforeAll(async () => {
    redis = new Redis(redisUrl ?? '');
    await redis.ping();
  });
  afterAll(() => redis.disconnect());
  contract(
    'redisCounters',
    () => ({
      counters: redisCounters(redis),
      advance: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    }),
    2000,
  );
});
