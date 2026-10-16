import type * as SessionModule from '../src/lib/session';

/**
 * §11 token refresh: one refresh at a time (the API revokes the session when a superseded refresh
 * token is reused), sign out only on a definite 401, keep the session when offline.
 */
const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}));
jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: {
    getItemSync: () => null,
    setItemSync: () => {},
    removeItemSync: () => {},
    getAllKeysSync: () => [],
  },
}));

type Reply = { status: number; body?: unknown } | 'offline';
let replies: Reply[] = [];
const calls: { url: string; body: unknown }[] = [];

beforeAll(() => {
  globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const req = input as Request;
    calls.push({
      url: req.url,
      body: await req
        .clone()
        .json()
        .catch(() => null),
    });
    await new Promise<void>((r) => setTimeout(r, 5)); // let concurrent callers pile up
    const reply = replies.shift() ?? { status: 500 };
    if (reply === 'offline') throw new TypeError('Network request failed');
    return new Response(JSON.stringify(reply.body ?? {}), {
      status: reply.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
});

const tokens = (n: number) => ({
  status: 200,
  body: { accessToken: `access-${n}`, accessTokenExpiresIn: 900, refreshToken: `refresh-${n}` },
});

function load() {
  let mod!: typeof SessionModule;
  jest.isolateModules(() => {
    mod = jest.requireActual('../src/lib/session');
  });
  return mod;
}

beforeEach(() => {
  mockStore.clear();
  calls.length = 0;
  replies = [];
});

it('concurrent callers share one refresh request and the rotated token is stored', async () => {
  mockStore.set('vl_rt', 'refresh-0');
  replies = [tokens(1)];
  const { refreshAccessToken } = load();
  const results = await Promise.all([
    refreshAccessToken(),
    refreshAccessToken(),
    refreshAccessToken(),
  ]);
  expect(results).toEqual(['access-1', 'access-1', 'access-1']);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.url).toMatch(/\/v1\/auth\/refresh$/);
  expect(calls[0]?.body).toEqual({ refreshToken: 'refresh-0' });
  expect(mockStore.get('vl_rt')).toBe('refresh-1');
  // A fresh access token is reused without another request.
  expect(await refreshAccessToken()).toBe('access-1');
  expect(calls).toHaveLength(1);
});

it('a 401 from refresh signs the user out (drops the refresh token)', async () => {
  mockStore.set('vl_rt', 'refresh-0');
  replies = [{ status: 401, body: { code: 'unauthenticated' } }];
  const { refreshAccessToken } = load();
  expect(await refreshAccessToken()).toBeNull();
  expect(mockStore.has('vl_rt')).toBe(false);
});

it('offline keeps the session: the refresh token stays for when the connection returns', async () => {
  mockStore.set('vl_rt', 'refresh-0');
  replies = ['offline', tokens(2)];
  const { refreshAccessToken } = load();
  await expect(refreshAccessToken()).rejects.toThrow('Network request failed');
  expect(mockStore.get('vl_rt')).toBe('refresh-0');
  expect(await refreshAccessToken()).toBe('access-2');
});
