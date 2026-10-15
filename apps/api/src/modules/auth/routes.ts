import { and, eq, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { DEVICE_PLATFORMS } from '@vetlink/shared';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { devices } from '../../db/schema/index.js';
import { DomainError, parseInput } from '../../lib/errors.js';
import { access, authOf } from './access.js';
import { logout, refresh, requestOtp, verifyOtp } from './service.js';
import { enableTwoFactor, setupTwoFactor, stepUp, verifyTwoFactor } from './two-factor.js';

const phone = z.string().min(1).max(32);
const otpCode = z.string().regex(/^\d{6}$/);
const totpCode = z.string().regex(/^\d{6}$/);

const schemas = {
  otpRequest: z.object({ phone }),
  otpVerify: z.object({
    phone,
    code: otpCode,
    device: z.object({
      platform: z.enum(DEVICE_PLATFORMS),
      appVersion: z.string().max(32).optional(),
    }),
  }),
  refresh: z.object({ refreshToken: z.string().min(1).max(256) }),
  totp: z.object({ code: totpCode }),
  twoFactorVerify: z.union([
    z.object({ code: totpCode }),
    z.object({ recoveryCode: z.string().min(1).max(32) }),
  ]),
  device: z.object({
    pushToken: z.string().min(1).max(4096).nullable().optional(),
    appVersion: z.string().max(32).optional(),
    notificationsEnabled: z.boolean().optional(),
  }),
};

export function authRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/v1/auth/otp/request', { config: { access: access.public } }, async (req, reply) => {
    const body = parseInput(schemas.otpRequest, req.body);
    return reply.code(202).send(await requestOtp(ctx, { phone: body.phone, ip: req.ip }, req.log));
  });

  app.post('/v1/auth/otp/verify', { config: { access: access.public } }, async (req) => {
    const body = parseInput(schemas.otpVerify, req.body);
    return verifyOtp(ctx, { ...body, ip: req.ip }, req.log);
  });

  app.post('/v1/auth/refresh', { config: { access: access.public } }, async (req) => {
    const body = parseInput(schemas.refresh, req.body);
    return refresh(ctx, body.refreshToken, req.log);
  });

  app.post('/v1/auth/logout', { config: { access: access.user } }, async (req, reply) => {
    await logout(ctx, authOf(req).sessionId);
    return reply.code(204).send();
  });

  // Admin 2FA. Open to any signed-in user; the service answers "not found" for non-admins.
  app.post('/v1/auth/2fa/setup', { config: { access: access.user } }, async (req) =>
    setupTwoFactor(ctx, authOf(req)),
  );

  app.post('/v1/auth/2fa/enable', { config: { access: access.user } }, async (req) => {
    const body = parseInput(schemas.totp, req.body);
    return enableTwoFactor(ctx, authOf(req), body.code, req.log);
  });

  app.post('/v1/auth/2fa/verify', { config: { access: access.user } }, async (req, reply) => {
    const body = parseInput(schemas.twoFactorVerify, req.body);
    await verifyTwoFactor(ctx, authOf(req), body, req.log);
    return reply.code(204).send();
  });

  app.post('/v1/auth/step-up', { config: { access: access.user } }, async (req, reply) => {
    const body = parseInput(schemas.totp, req.body);
    await stepUp(ctx, authOf(req), body.code, req.log);
    return reply.code(204).send();
  });

  /** Update this session's device (push token, app version, notification switch). */
  app.post('/v1/devices', { config: { access: access.user } }, async (req, reply) => {
    const auth = authOf(req);
    const body = parseInput(schemas.device, req.body);
    if (!auth.deviceId) throw new DomainError('not_found');
    const deviceId = auth.deviceId;
    await ctx.db.transaction(async (tx) => {
      if (body.pushToken) {
        // A push token belongs to one install. If the phone changed hands (another account
        // signed in on it), stop pushing the previous account's notifications to it.
        await tx
          .update(devices)
          .set({ pushToken: null })
          .where(and(eq(devices.pushToken, body.pushToken), ne(devices.id, deviceId)));
      }
      await tx
        .update(devices)
        .set({
          ...(body.pushToken !== undefined && { pushToken: body.pushToken }),
          ...(body.appVersion !== undefined && { appVersion: body.appVersion }),
          ...(body.notificationsEnabled !== undefined && {
            notificationsEnabled: body.notificationsEnabled,
          }),
          lastSeenAt: ctx.clock(),
        })
        .where(and(eq(devices.id, deviceId), eq(devices.userId, auth.userId)));
    });
    return reply.code(204).send();
  });
}
