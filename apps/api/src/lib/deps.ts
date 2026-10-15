import postgres from 'postgres';
import { Redis } from 'ioredis';

export interface DependencyCheck {
  name: string;
  check: () => Promise<void>;
  close: () => Promise<void>;
}

export function postgresDependency(url: string): DependencyCheck {
  const sql = postgres(url, { max: 1, connect_timeout: 2, idle_timeout: 30 });
  return {
    name: 'db',
    check: async () => {
      await sql`select 1`;
    },
    close: () => sql.end({ timeout: 5 }),
  };
}

export function redisDependency(url: string): DependencyCheck {
  const redis = new Redis(url, {
    lazyConnect: true,
    connectTimeout: 2000,
    maxRetriesPerRequest: 1,
  });
  return {
    name: 'redis',
    check: async () => {
      if (redis.status === 'wait') await redis.connect();
      await redis.ping();
    },
    close: async () => {
      redis.disconnect();
    },
  };
}
