import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

const base = {
  APP_ENV: 'development',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/vetlink',
  REDIS_URL: 'redis://localhost:6379',
  SMS_MODE: 'log',
  PAYMENTS_MODE: 'mock',
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  JWT_SECRET: 'x'.repeat(32),
};

// What PAYMENTS_MODE=sandbox|live needs.
const daraja = {
  PUBLIC_BASE_URL: 'https://api.vetlink.example',
  WEBHOOK_SECRET: 'w'.repeat(24),
  DARAJA_CONSUMER_KEY: 'consumer-key',
  DARAJA_CONSUMER_SECRET: 'consumer-secret',
  DARAJA_SHORTCODE: '174379',
  DARAJA_PASSKEY: 'passkey',
  PUSH_MODE: 'expo',
  AT_USERNAME: 'vetlink',
  AT_API_KEY: 'at-api-key',
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

  it('rejects a DATA_ENCRYPTION_KEY that is not 32 bytes of base64', () => {
    const short = Buffer.alloc(16, 7).toString('base64');
    expect(() => loadConfig({ ...base, DATA_ENCRYPTION_KEY: short })).toThrow(
      /DATA_ENCRYPTION_KEY: must be 32 bytes/,
    );
    expect(() => loadConfig({ ...base, DATA_ENCRYPTION_KEY: undefined })).toThrow(
      /DATA_ENCRYPTION_KEY/,
    );
  });

  it.each([
    [{ SMS_MODE: 'log', PAYMENTS_MODE: 'live', ...daraja }, /SMS_MODE=log/],
    [{ SMS_MODE: 'live', PAYMENTS_MODE: 'mock', ...daraja }, /PAYMENTS_MODE=mock/],
  ])('fails startup in production when a dev shortcut is on (%o)', (modes, message) => {
    expect(() => loadConfig({ ...base, APP_ENV: 'production', ...modes })).toThrow(message);
  });

  it('requires a WEBHOOK_SECRET of 24+ characters in production only', () => {
    const prod = {
      ...base,
      APP_ENV: 'production',
      SMS_MODE: 'live',
      PAYMENTS_MODE: 'mock',
      PUSH_MODE: 'expo',
      AT_USERNAME: 'vetlink',
      AT_API_KEY: 'at-api-key',
    };
    // Without a secret, production refuses to start (whichever check notices first).
    expect(() => loadConfig(prod)).toThrow(/WEBHOOK_SECRET/);
    expect(() => loadConfig({ ...prod, WEBHOOK_SECRET: 'short' })).toThrow(/WEBHOOK_SECRET/);
    expect(loadConfig(base).WEBHOOK_SECRET).toBeUndefined();
  });

  it("SMS_MODE=sandbox|live needs Africa's Talking settings; live cannot use the sandbox app", () => {
    expect(() => loadConfig({ ...base, SMS_MODE: 'sandbox' })).toThrow(
      /SMS_MODE=sandbox needs: AT_USERNAME, AT_API_KEY, WEBHOOK_SECRET/,
    );
    expect(() =>
      loadConfig({ ...base, SMS_MODE: 'live', ...daraja, AT_USERNAME: 'sandbox' }),
    ).toThrow(/cannot use the sandbox/);
    expect(loadConfig({ ...base, SMS_MODE: 'sandbox', ...daraja }).AT_USERNAME).toBe('vetlink');
  });

  it('PAYMENTS_MODE=sandbox|live needs every Daraja setting', () => {
    expect(() => loadConfig({ ...base, PAYMENTS_MODE: 'sandbox' })).toThrow(
      /PAYMENTS_MODE=sandbox needs: PUBLIC_BASE_URL, WEBHOOK_SECRET, DARAJA_CONSUMER_KEY/,
    );
    expect(() =>
      loadConfig({ ...base, PAYMENTS_MODE: 'sandbox', ...daraja, DARAJA_SHORTCODE: '12' }),
    ).toThrow(/DARAJA_SHORTCODE/);
    expect(loadConfig({ ...base, PAYMENTS_MODE: 'sandbox', ...daraja }).DARAJA_SHORTCODE).toBe(
      '174379',
    );
  });

  it('requires a JWT_SECRET of at least 32 characters', () => {
    expect(() => loadConfig({ ...base, JWT_SECRET: 'change-me' })).toThrow(
      /JWT_SECRET: must be at least 32 characters/,
    );
    expect(() => loadConfig({ ...base, JWT_SECRET: undefined })).toThrow(/JWT_SECRET/);
  });

  it('accepts a 6-digit OTP_FIXED_CODE in development and treats empty as off', () => {
    expect(loadConfig({ ...base, OTP_FIXED_CODE: '123456' }).OTP_FIXED_CODE).toBe('123456');
    expect(loadConfig({ ...base, OTP_FIXED_CODE: '' }).OTP_FIXED_CODE).toBeUndefined();
    expect(() => loadConfig({ ...base, OTP_FIXED_CODE: '1234' })).toThrow(/OTP_FIXED_CODE/);
  });

  it('fails startup in production when OTP_FIXED_CODE is set', () => {
    const prod = {
      ...base,
      APP_ENV: 'production',
      SMS_MODE: 'live',
      PAYMENTS_MODE: 'live',
      ...daraja,
      WEBHOOK_SECRET: 'w'.repeat(24),
    };
    expect(() => loadConfig({ ...prod, OTP_FIXED_CODE: '123456' })).toThrow(/OTP_FIXED_CODE/);
    expect(() => loadConfig({ ...prod, OTP_FIXED_CODE: '' })).not.toThrow();
  });

  it('parses TRUST_PROXY as proxy IPs/CIDRs and refuses hop counts', () => {
    expect(loadConfig(base).TRUST_PROXY).toBeUndefined();
    expect(loadConfig({ ...base, TRUST_PROXY: '' }).TRUST_PROXY).toBeUndefined();
    expect(
      loadConfig({ ...base, TRUST_PROXY: '10.0.0.1, 172.16.0.0/12,uniquelocal' }).TRUST_PROXY,
    ).toEqual(['10.0.0.1', '172.16.0.0/12', 'uniquelocal']);
    expect(() => loadConfig({ ...base, TRUST_PROXY: '1' })).toThrow(/hop counts are not allowed/);
    expect(() => loadConfig({ ...base, TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY/);
    expect(() => loadConfig({ ...base, TRUST_PROXY: 'proxy.example.com' })).toThrow(/TRUST_PROXY/);
  });

  it('allows dev shortcuts in staging and test but not production', () => {
    expect(() => loadConfig({ ...base, APP_ENV: 'staging' })).not.toThrow();
    expect(() =>
      loadConfig({
        ...base,
        APP_ENV: 'production',
        SMS_MODE: 'live',
        PAYMENTS_MODE: 'live',
        ...daraja,
        WEBHOOK_SECRET: 'w'.repeat(24),
      }),
    ).not.toThrow();
  });
});
