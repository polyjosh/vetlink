import { useQuery } from '@tanstack/react-query';
import { readCache, writeCache } from './storage';

/**
 * A server read through TanStack Query. With `cache`, the last good answer is kept on the device
 * and shown at once (and offline) while a fresh one loads (§11 offline-first).
 */
export function useApi<T>(
  key: readonly unknown[],
  fn: () => Promise<{ data?: T | undefined; error?: unknown }>,
  opts: { cache?: string; refetchInterval?: number | false; enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await fn();
      if (error || data === undefined) throw error ?? new Error('empty');
      if (opts.cache) writeCache(opts.cache, data);
      return data;
    },
    ...(opts.cache && {
      initialData: () => readCache<T>(opts.cache ?? ''),
      initialDataUpdatedAt: 0,
    }),
    refetchInterval: opts.refetchInterval ?? false,
    enabled: opts.enabled ?? true,
  });
}
