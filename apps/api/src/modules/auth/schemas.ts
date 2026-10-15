import { DEVICE_PLATFORMS } from '@vetlink/shared';
import { z } from 'zod';
import { named } from '../../schemas/common.js';

const phone = z.string().min(1).max(32).describe('Kenyan mobile: 07…, 01…, 2547… or +2547…');
const sixDigits = z.string().regex(/^\d{6}$/);

export const otpRequestBody = z.object({ phone });
export const otpRequested = named(z.object({ expiresInSeconds: z.number().int() }), 'OtpRequested');

export const otpVerifyBody = z.object({
  phone,
  code: sixDigits,
  device: z.object({
    platform: z.enum(DEVICE_PLATFORMS),
    appVersion: z.string().max(32).optional(),
  }),
});

export const tokens = named(
  z.object({
    accessToken: z.string(),
    accessTokenExpiresIn: z.number().int().describe('Seconds'),
    refreshToken: z.string().describe('Opaque; rotate on every use, refresh single-flight'),
  }),
  'Tokens',
);
export const signedIn = named(tokens.extend({ isNewUser: z.boolean() }), 'SignedIn');

export const refreshBody = z.object({ refreshToken: z.string().min(1).max(256) });
export const totpBody = z.object({ code: sixDigits });
export const twoFactorVerifyBody = z.union([
  z.object({ code: sixDigits }),
  z.object({ recoveryCode: z.string().min(1).max(32) }),
]);
export const twoFactorSetup = named(
  z.object({ secret: z.string(), otpauthUri: z.string() }),
  'TwoFactorSetup',
);
export const recoveryCodes = named(
  z.object({ recoveryCodes: z.array(z.string()).describe('Shown once; store safely') }),
  'RecoveryCodes',
);
export const deviceBody = z.object({
  pushToken: z.string().min(1).max(4096).nullable().optional(),
  appVersion: z.string().max(32).optional(),
  notificationsEnabled: z.boolean().optional(),
});
