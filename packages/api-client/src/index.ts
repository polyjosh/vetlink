import createClient, { type Client, type Middleware } from 'openapi-fetch';
import type { components, paths } from './schema.js';

/**
 * Typed VetLink API client, generated from the API's OpenAPI document (`pnpm api:generate`).
 * Mobile and web use only this client (§10). Request and response types come from the server's
 * zod schemas, so a mismatch is a compile error, not a runtime surprise.
 */
export type { components, paths };
export type Schemas = components['schemas'];
export type ApiError = Schemas['Error'];
export type ApiClient = Client<paths>;

export interface ApiClientOptions {
  /** e.g. `https://api.vetlink.example` (no trailing `/v1`). */
  baseUrl: string;
  /** `app` for the mobile app, `web` for the web app (analytics only). */
  channel: 'app' | 'web';
  /** Current access token, if signed in. */
  getAccessToken?: () => string | null | undefined | Promise<string | null | undefined>;
  /** Custom fetch (tests, React Native polyfills). */
  fetch?: (input: Request) => Promise<Response>;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const client = createClient<paths>({
    baseUrl: options.baseUrl,
    ...(options.fetch && { fetch: options.fetch }),
  });
  const headers: Middleware = {
    async onRequest({ request }) {
      request.headers.set('X-VetLink-Channel', options.channel);
      const token = await options.getAccessToken?.();
      if (token) request.headers.set('Authorization', `Bearer ${token}`);
      return request;
    },
  };
  client.use(headers);
  return client;
}

/** A new idempotency key for one user action (generate on tap, reuse on every retry). */
export function newIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}
