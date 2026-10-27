import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';
import { createApiClient, type ApiClient, type Schemas } from '@vetlink/api-client';
import { API_URL, APP_VERSION } from './config';
import { clearUserData, secure } from './storage';

type Me = Schemas['Me'];

const REFRESH_KEY = 'vl_rt';
const REFRESH_EARLY_MS = 60_000;

let token: { value: string; expiresAt: number } | null = null;
let inflight: Promise<string | null> | null = null;

const fresh = () => (token && token.expiresAt - REFRESH_EARLY_MS > Date.now() ? token.value : null);

function keep(accessToken: string, expiresIn: number) {
  token = { value: accessToken, expiresAt: Date.now() + expiresIn * 1000 };
}

const raw = createApiClient({ baseUrl: API_URL, channel: 'app' });

/**
 * Single-flight refresh (§11): concurrent callers share one request. The API revokes the whole
 * session if a superseded refresh token is reused, so two refreshes must never race.
 */
export function refreshAccessToken(): Promise<string | null> {
  inflight ??= (async () => {
    const current = fresh();
    if (current) return current;
    const refreshToken = await secure.get(REFRESH_KEY);
    if (!refreshToken) return null;
    const { data, response } = await raw.POST('/v1/auth/refresh', { body: { refreshToken } });
    if (!data) {
      // Only a definite "no" signs the user out; offline keeps the session for later.
      if (response.status === 401) await secure.remove(REFRESH_KEY);
      token = null;
      return null;
    }
    keep(data.accessToken, data.accessTokenExpiresIn);
    await secure.set(REFRESH_KEY, data.refreshToken);
    return data.accessToken;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** The app's API client: channel `app`, bearer token refreshed as needed. */
export const api: ApiClient = createApiClient({
  baseUrl: API_URL,
  channel: 'app',
  getAccessToken: () => fresh() ?? refreshAccessToken(),
});

interface Session {
  status: 'loading' | 'signed_out' | 'signed_in' | 'offline';
  me: Me | null;
  reloadMe: () => Promise<Me | null>;
  login: (
    phone: string,
    code: string,
  ) => Promise<{ error?: { code: string; message_key: string } }>;
  logout: () => Promise<void>;
}

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Session['status']>('loading');
  const [me, setMe] = useState<Me | null>(null);

  const reloadMe = useCallback(async () => {
    try {
      const { data, response } = await api.GET('/v1/me');
      setMe(data ?? null);
      setStatus(data ? 'signed_in' : response.status === 401 ? 'signed_out' : 'offline');
      return data ?? null;
    } catch {
      setStatus((s) => (s === 'loading' ? 'offline' : s));
      return null;
    }
  }, []);

  useEffect(() => {
    let live = true;
    void secure.get(REFRESH_KEY).then(async (rt) => {
      if (!live) return;
      if (rt) await reloadMe();
      else setStatus('signed_out');
    });
    return () => {
      live = false;
    };
  }, [reloadMe]);

  const login = useCallback<Session['login']>(
    async (phone, code) => {
      const platform = Platform.OS === 'ios' ? 'ios' : 'android';
      const { data, error } = await raw.POST('/v1/auth/otp/verify', {
        body: { phone, code, device: { platform, appVersion: APP_VERSION } },
      });
      if (!data)
        return { error: error ?? { code: 'internal_error', message_key: 'errors.internal_error' } };
      keep(data.accessToken, data.accessTokenExpiresIn);
      await secure.set(REFRESH_KEY, data.refreshToken);
      await reloadMe();
      return {};
    },
    [reloadMe],
  );

  const logout = useCallback(async () => {
    await api.POST('/v1/auth/logout').catch(() => undefined);
    await secure.remove(REFRESH_KEY);
    token = null;
    clearUserData();
    setMe(null);
    setStatus('signed_out');
  }, []);

  const value = useMemo(
    () => ({ status, me, reloadMe, login, logout }),
    [status, me, reloadMe, login, logout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}
