'use client';

import { useEffect, useEffectEvent } from 'react';

/**
 * Call `fn` now and every `ms` while `active` (pauses in hidden tabs to save data). A new `fn`
 * (different filters) restarts it.
 */
export function usePoll(fn: () => void | Promise<void>, ms: number, active = true) {
  const tick = useEffectEvent(() => void fn());
  useEffect(() => {
    if (!active) return;
    tick();
    if (!Number.isFinite(ms)) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') tick();
    }, ms);
    return () => clearInterval(id);
  }, [fn, ms, active]);
}

/** Load once (and again whenever `fn` changes). */
export function useLoad(fn: () => void | Promise<void>) {
  usePoll(fn, Infinity);
}
