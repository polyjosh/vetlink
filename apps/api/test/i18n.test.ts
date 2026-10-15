import { describe, expect, it } from 'vitest';
import { interpolate, messages } from '@vetlink/i18n';
import { ERROR_STATUS } from '../src/lib/errors.js';

function keysOf(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? keysOf(v as object, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe('i18n', () => {
  it('sw and en have exactly the same keys', () => {
    expect(keysOf(messages.sw).sort()).toEqual(keysOf(messages.en).sort());
  });

  it('every API error code has a message in both languages', () => {
    for (const code of Object.keys(ERROR_STATUS)) {
      expect(messages.en.errors).toHaveProperty(code);
      expect(messages.sw.errors).toHaveProperty(code);
    }
  });

  it('interpolates placeholders and leaves unknown ones visible', () => {
    expect(interpolate('Code {code} ({minutes} min)', { code: '123456', minutes: 5 })).toBe(
      'Code 123456 (5 min)',
    );
    expect(interpolate('Hi {name}', {})).toBe('Hi {name}');
  });
});
