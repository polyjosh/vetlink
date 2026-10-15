import { Writable } from 'node:stream';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { loggerOptions } from '../src/lib/logger.js';
import { maskPhone, maskPhonesInText } from '../src/lib/phone.js';
import { logSmsSender } from '../src/lib/sms.js';
import type { AppEnv } from '@vetlink/shared';

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { log: pino(loggerOptions('info'), stream), lines };
}

describe('phone masking', () => {
  it('masks numbers to 2547****123 form', () => {
    expect(maskPhone('254712345123')).toBe('2547****123');
    expect(maskPhone('+254712345123')).toBe('2547****123');
    expect(maskPhone('123')).toBe('****');
  });

  it('masks numbers embedded in text', () => {
    expect(maskPhonesInText('from +254712345123 and 0712345123')).toBe(
      'from 2547****123 and 0712****123',
    );
  });
});

describe('logger', () => {
  it('never writes a full phone number, OTP or token', () => {
    const { log, lines } = capture();
    log.info({ user: { otp: '123456', token: 'tok-abc' } }, 'OTP sent to 254712345123');
    const out = lines.join('');
    expect(out).not.toContain('254712345123');
    expect(out).not.toContain('123456');
    expect(out).not.toContain('tok-abc');
    expect(out).toContain('2547****123');
  });

  it('drops query strings from request URLs', () => {
    const { log, lines } = capture();
    log.info({ req: { id: '1', method: 'GET', url: '/x?phone=254712345123' } }, 'request');
    const out = lines.join('');
    expect(out).not.toContain('phone=');
    expect(out).toContain('"url":"/x"');
  });
});

describe('error logging', () => {
  it('drops query parameters and masks phones in database errors and their causes', () => {
    const { log, lines } = capture();
    const pgError = Object.assign(new Error('duplicate key value violates unique constraint'), {
      detail: 'Key (phone)=(254712345678) already exists.',
      parameters: ['254712345678', 'otp-hash-abc'],
    });
    const err = new DrizzleQueryError(
      'insert into "users" ("phone") values ($1)',
      ['254712345678', 'token-hash-xyz'],
      pgError,
    );
    log.error({ err }, 'unhandled error');
    const out = lines.join('');
    expect(out).not.toContain('254712345678');
    expect(out).not.toContain('token-hash-xyz');
    expect(out).not.toContain('otp-hash-abc');
    expect(out).toContain('2547****678');
    expect(out).toContain('insert into'); // the query text (no values) is kept for debugging
    expect(out).toContain('duplicate key value');
  });
});

describe('SMS_MODE=log sender', () => {
  const sendWith = async (appEnv: AppEnv) => {
    const { log, lines } = capture();
    await logSmsSender(log, appEnv).send('254712345678', 'Your VetLink code is 482913.');
    return lines.join('');
  };

  it('shows codes in development and test, never the full number', async () => {
    const out = await sendWith('development');
    expect(out).toContain('482913');
    expect(out).not.toContain('254712345678');
  });

  it('masks codes in staging', async () => {
    const out = await sendWith('staging');
    expect(out).not.toContain('482913');
    expect(out).toContain('Your VetLink code is ****.');
  });
});
