import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { DependencyCheck } from '../src/lib/deps.js';

function dep(name: string, check: () => Promise<void>): DependencyCheck {
  return { name, check, close: vi.fn(async () => {}) };
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('health endpoints', () => {
  it('GET /health is ok even when dependencies are down', async () => {
    app = buildApp({
      logLevel: 'silent',
      deps: [dep('db', () => Promise.reject(new Error('down')))],
    });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /ready is 200 when db and redis respond', async () => {
    app = buildApp({
      logLevel: 'silent',
      deps: [dep('db', async () => {}), dep('redis', async () => {})],
    });
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', checks: { db: 'ok', redis: 'ok' } });
  });

  it('GET /ready is 503 and names the failing dependency', async () => {
    app = buildApp({
      logLevel: 'silent',
      deps: [
        dep('db', async () => {}),
        dep('redis', () => Promise.reject(new Error('ECONNREFUSED'))),
      ],
    });
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'unavailable', checks: { db: 'ok', redis: 'error' } });
  });

  it('GET /ready times out a hanging dependency instead of hanging the probe', async () => {
    app = buildApp({
      logLevel: 'silent',
      deps: [dep('db', () => new Promise<void>(() => {}))],
    });
    // Load plugins on real timers; only the probe's own timeout runs on fake time.
    await app.ready();
    vi.useFakeTimers();
    try {
      const pending = app.inject({ method: 'GET', url: '/ready' });
      await vi.advanceTimersByTimeAsync(2500);
      const res = await pending;
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ checks: { db: 'error' } });
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes dependencies on shutdown', async () => {
    const db = dep('db', async () => {});
    app = buildApp({ logLevel: 'silent', deps: [db] });
    await app.close();
    app = undefined;
    expect(db.close).toHaveBeenCalledOnce();
  });
});
