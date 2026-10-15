import { and, eq, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { AppContext } from '../../context.js';
import { devices } from '../../db/schema/index.js';
import { DomainError } from '../../lib/errors.js';
import { noContent, responses } from '../../schemas/common.js';
import { access, authOf } from './access.js';
import {
  deviceBody,
  otpRequestBody,
  otpRequested,
  otpVerifyBody,
  recoveryCodes,
  refreshBody,
  signedIn,
  tokens,
  totpBody,
  twoFactorSetup,
  twoFactorVerifyBody,
} from './schemas.js';
import { logout, refresh, requestOtp, verifyOtp } from './service.js';
import { enableTwoFactor, setupTwoFactor, stepUp, verifyTwoFactor } from './two-factor.js';

const tags = ['auth'];

export function authRoutes(app: FastifyInstance, ctx: AppContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/v1/auth/otp/request',
    {
      config: { access: access.public },
      schema: {
        tags,
        summary: 'Send a login code by SMS',
        description: 'Same response whether or not the number has an account.',
        body: otpRequestBody,
        response: responses({ 202: otpRequested }),
      },
    },
    async (req, reply) =>
      reply.code(202).send(await requestOtp(ctx, { phone: req.body.phone, ip: req.ip }, req.log)),
  );

  r.post(
    '/v1/auth/otp/verify',
    {
      config: { access: access.public },
      schema: {
        tags,
        summary: 'Sign in with the code (creates the account on first login)',
        body: otpVerifyBody,
        response: responses({ 200: signedIn }),
      },
    },
    async (req) => verifyOtp(ctx, { ...req.body, ip: req.ip }, req.log),
  );

  r.post(
    '/v1/auth/refresh',
    {
      config: { access: access.public },
      schema: {
        tags,
        summary: 'Rotate the refresh token (call single-flight)',
        body: refreshBody,
        response: responses({ 200: tokens }),
      },
    },
    async (req) => refresh(ctx, req.body.refreshToken, req.log),
  );

  r.post(
    '/v1/auth/logout',
    {
      config: { access: access.user },
      schema: { tags, summary: 'End this session', response: responses({ 204: noContent }) },
    },
    async (req, reply) => {
      await logout(ctx, authOf(req).sessionId);
      return reply.code(204).send(null);
    },
  );

  // Admin 2FA. Open to any signed-in user; the service answers "not found" for non-admins.
  r.post(
    '/v1/auth/2fa/setup',
    {
      config: { access: access.user },
      schema: {
        tags,
        summary: 'Admin: start authenticator enrolment (inside the enrolment window)',
        response: responses({ 200: twoFactorSetup }),
      },
    },
    async (req) => setupTwoFactor(ctx, authOf(req)),
  );

  r.post(
    '/v1/auth/2fa/enable',
    {
      config: { access: access.user },
      schema: {
        tags,
        summary: 'Admin: finish enrolment with a first code; returns recovery codes once',
        body: totpBody,
        response: responses({ 200: recoveryCodes }),
      },
    },
    async (req) => enableTwoFactor(ctx, authOf(req), req.body.code, req.log),
  );

  r.post(
    '/v1/auth/2fa/verify',
    {
      config: { access: access.user },
      schema: {
        tags,
        summary: 'Admin: satisfy 2FA on this session (TOTP or a recovery code)',
        body: twoFactorVerifyBody,
        response: responses({ 204: noContent }),
      },
    },
    async (req, reply) => {
      await verifyTwoFactor(ctx, authOf(req), req.body, req.log);
      return reply.code(204).send(null);
    },
  );

  r.post(
    '/v1/auth/step-up',
    {
      config: { access: access.user },
      schema: {
        tags,
        summary: 'Admin: fresh TOTP before a sensitive action (valid 5 minutes)',
        body: totpBody,
        response: responses({ 204: noContent }),
      },
    },
    async (req, reply) => {
      await stepUp(ctx, authOf(req), req.body.code, req.log);
      return reply.code(204).send(null);
    },
  );

  r.post(
    '/v1/devices',
    {
      config: { access: access.user },
      schema: {
        tags: ['devices'],
        summary: "Update this session's device: push token, app version, notifications",
        body: deviceBody,
        response: responses({ 204: noContent }),
      },
    },
    async (req, reply) => {
      const auth = authOf(req);
      const body = req.body;
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
      return reply.code(204).send(null);
    },
  );
}
