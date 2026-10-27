'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { createApiClient, type ApiClient, type Schemas } from '@vetlink/api-client';

type Me = Schemas['Me'];

interface Session {
  status: 'loading' | 'signed_out' | 'signed_in';
  me: Me | null;
  api: ApiClient;
  /** Re-read /v1/me (after a role, consent or profile change). */
  reloadMe: () => Promise<Me | null>;
  login: (
    phone: string,
    code: string,
  ) => Promise<{ ok: true } | { ok: false; error: ApiErrorLike }>;
  logout: () => Promise<void>;
}

export interface ApiErrorLike {
  code: string;
  message_key: string;
  details?: Record<string, unknown>;
}

const Ctx = createContext<Session | null>(null);

/** Refresh this long before the access token expires. */
const REFRESH_EARLY_MS = 60_000;

/**
 * The session lives in memory (access token, here) plus an httpOnly cookie (refresh token) handled
 * by /api/session/*. Refresh is single-flight: one request per tab (shared promise) and one across
 * tabs (Web Locks), as the API requires (M7 decision).
 */
let token: { value: string; expiresAt: number } | null = null;
let inflight: Promise<string | null> | null = null;

const fresh = () => (token && token.expiresAt - REFRESH_EARLY_MS > Date.now() ? token.value : null);

function setToken(accessToken: string | null, expiresIn = 900) {
  token = accessToken ? { value: accessToken, expiresAt: Date.now() + expiresIn * 1000 } : null;
}

function refresh(): Promise<string | null> {
  if (inflight) return inflight;
  const call = async () => {
    const current = fresh();
    if (current) return current;
    const res = await fetch('/api/session/refresh', {
      method: 'POST',
      headers: { 'x-vetlink-csrf': '1' },
    });
    if (!res.ok) {
      setToken(null);
      return null;
    }
    const body = (await res.json()) as { accessToken: string; expiresIn: number };
    setToken(body.accessToken, body.expiresIn);
    return body.accessToken;
  };
  inflight = (navigator.locks ? navigator.locks.request('vetlink-refresh', call) : call()).finally(
    () => {
      inflight = null;
    },
  );
  return inflight;
}

// Same origin: the Next.js server forwards /v1/* to the API (no CORS, API host never exposed).
const api = createApiClient({
  baseUrl: '',
  channel: 'web',
  getAccessToken: () => fresh() ?? refresh(),
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Session['status']>('loading');
  const [me, setMe] = useState<Me | null>(null);

  const reloadMe = useCallback(async () => {
    const { data } = await api.GET('/v1/me');
    setMe(data ?? null);
    setStatus(data ? 'signed_in' : 'signed_out');
    return data ?? null;
  }, []);

  useEffect(() => {
    let live = true;
    void refresh().then(async (t) => {
      if (!live) return;
      if (t) await reloadMe();
      else setStatus('signed_out');
    });
    return () => {
      live = false;
    };
  }, [reloadMe]);

  const login = useCallback<Session['login']>(
    async (phone, code) => {
      const res = await fetch('/api/session/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-vetlink-csrf': '1' },
        body: JSON.stringify({ phone, code }),
      });
      const body = (await res.json()) as {
        accessToken?: string;
        expiresIn?: number;
      } & Partial<ApiErrorLike>;
      if (!res.ok || !body.accessToken) {
        return {
          ok: false,
          error: {
            code: body.code ?? 'internal_error',
            message_key: body.message_key ?? 'errors.internal_error',
          },
        };
      }
      setToken(body.accessToken, body.expiresIn);
      await reloadMe();
      return { ok: true };
    },
    [reloadMe],
  );

  const logout = useCallback(async () => {
    const t = token?.value;
    await fetch('/api/session/logout', {
      method: 'POST',
      headers: { 'x-vetlink-csrf': '1', ...(t && { authorization: `Bearer ${t}` }) },
    });
    setToken(null);
    setMe(null);
    setStatus('signed_out');
  }, []);

  const value = useMemo(
    () => ({ status, me, api, reloadMe, login, logout }),
    [status, me, reloadMe, login, logout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}
