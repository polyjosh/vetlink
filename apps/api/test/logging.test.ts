import { Writable } from 'node:stream';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { loggerOptions } from '../src/lib/logger.js';
import { maskPhone, maskPhonesInText } from '../src/lib/phone.js';

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
