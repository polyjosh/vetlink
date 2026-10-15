import type { Redis } from 'ioredis';

/**
 * Short-lived counters and one-time markers for rate limits, lockouts and replay protection.
 * Redis in the running app; an in-memory version for unit tests.
 */
export interface Counters {
  /** Increment `key`; the window (TTL) starts at the first hit. Returns the new count. */
  hit(key: string, windowMs: number): Promise<number>;
  get(key: string): Promise<number>;
  reset(key: string): Promise<void>;
  /** Set `key` only if absent. True if this call claimed it (first use), false if already taken. */
  claim(key: string, ttlMs: number): Promise<boolean>;
}

const PREFIX = 'vl:';

// INCR and set the TTL in one round trip, so a crash between them cannot leave a key that
// never expires (a permanent lockout).
const HIT_SCRIPT = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return n`;

export function redisCounters(redis: Redis): Counters {
  return {
    async hit(key, windowMs) {
      return Number(await redis.eval(HIT_SCRIPT, 1, PREFIX + key, windowMs));
    },
    async get(key) {
      return Number((await redis.get(PREFIX + key)) ?? 0);
    },
    async reset(key) {
      await redis.del(PREFIX + key);
    },
    async claim(key, ttlMs) {
      return (await redis.set(PREFIX + key, '1', 'PX', ttlMs, 'NX')) === 'OK';
    },
  };
}

export function memoryCounters(clock: () => Date = () => new Date()): Counters {
  const store = new Map<string, { value: number; expiresAt: number }>();
  const live = (key: string) => {
    const entry = store.get(key);
    if (entry && entry.expiresAt <= clock().getTime()) {
      store.delete(key);
      return undefined;
    }
    return entry;
  };
  return {
    async hit(key, windowMs) {
      const entry = live(key) ?? { value: 0, expiresAt: clock().getTime() + windowMs };
      entry.value += 1;
      store.set(key, entry);
      return entry.value;
    },
    async get(key) {
      return live(key)?.value ?? 0;
    },
    async reset(key) {
      store.delete(key);
    },
    async claim(key, ttlMs) {
      if (live(key)) return false;
      store.set(key, { value: 1, expiresAt: clock().getTime() + ttlMs });
      return true;
    },
  };
}
