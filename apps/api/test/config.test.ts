import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

const base = {
  APP_ENV: 'development',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/vetlink',
  REDIS_URL: 'redis://localhost:6379',
  SMS_MODE: 'log',
  PAYMENTS_MODE: 'mock',
};

describe('loadConfig', () => {
  it('accepts a valid development environment and applies defaults', () => {
    const config = loadConfig(base);
    expect(config.PORT).toBe(4000);
    expect(config.HOST).toBe('0.0.0.0');
    expect(config.SMS_MODE).toBe('log');
  });

  it('rejects a missing or invalid variable without echoing values', () => {
    const run = () =>
      loadConfig({ ...base, DATABASE_URL: 'not-a-url-secretvalue', SMS_MODE: undefined });
    expect(run).toThrow(ConfigError);
    expect(run).toThrow(/DATABASE_URL/);
    expect(run).toThrow(/SMS_MODE/);
    expect(run).not.toThrow(/secretvalue/);
  });

  it.each([
    [{ SMS_MODE: 'log', PAYMENTS_MODE: 'live' }, /SMS_MODE=log/],
    [{ SMS_MODE: 'live', PAYMENTS_MODE: 'mock' }, /PAYMENTS_MODE=mock/],
  ])('fails startup in production when a dev shortcut is on (%o)', (modes, message) => {
    expect(() => loadConfig({ ...base, APP_ENV: 'production', ...modes })).toThrow(message);
  });

  it('allows dev shortcuts in staging and test but not production', () => {
    expect(() => loadConfig({ ...base, APP_ENV: 'staging' })).not.toThrow();
    expect(() =>
      loadConfig({ ...base, APP_ENV: 'production', SMS_MODE: 'live', PAYMENTS_MODE: 'live' }),
    ).not.toThrow();
  });
});
