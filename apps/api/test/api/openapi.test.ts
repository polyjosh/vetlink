import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { exportOpenApi } from '../../src/openapi/export.js';

interface OpenApiDoc {
  paths: Record<
    string,
    Record<string, { security?: unknown[]; description?: string; tags?: string[] }>
  >;
  components: { schemas: Record<string, unknown> };
}

describe('OpenAPI document', () => {
  it('the committed client matches the code (run `pnpm api:generate` if this fails)', async () => {
    const committed = readFileSync(
      new URL('../../../../packages/api-client/openapi.json', import.meta.url),
      'utf8',
    );
    expect(await exportOpenApi()).toBe(committed);
  });

  it('documents every route with its access rule; only public routes lack bearer auth', async () => {
    const doc = JSON.parse(await exportOpenApi()) as OpenApiDoc;
    const publicRoutes = new Set([
      'get /health',
      'get /ready',
      'get /v1/meta/min-app-version',
      'post /v1/auth/otp/request',
      'post /v1/auth/otp/verify',
      'post /v1/auth/refresh',
      'get /v1/locations/counties',
      'get /v1/locations/wards',
    ]);
    const seen: string[] = [];
    for (const [path, ops] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(ops)) {
        const key = `${method} ${path}`;
        seen.push(key);
        expect(op.description, key).toMatch(/^Access: /);
        expect(op.tags?.length, key).toBeGreaterThan(0);
        if (publicRoutes.has(key)) expect(op.security, key).toBeUndefined();
        else expect(op.security, key).toEqual([{ bearer: [] }]);
      }
    }
    expect(seen).toEqual(expect.arrayContaining([...publicRoutes]));
    expect(seen.filter((k) => k.includes('/v1/admin/'))).toHaveLength(4);
  });

  it('exposes named schemas for clients', async () => {
    const doc = JSON.parse(await exportOpenApi()) as OpenApiDoc;
    for (const name of ['Me', 'FarmerBooking', 'VetJob', 'Offer', 'Error', 'Tokens', 'Animal']) {
      expect(doc.components.schemas).toHaveProperty(name);
    }
  });
});
