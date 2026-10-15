import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import {
  jsonSchemaTransform,
  jsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import type { DestinationStream } from 'pino';
import type { AppContext } from './context.js';
import type { DependencyCheck } from './lib/deps.js';
import { registerErrorHandling } from './lib/errors.js';
import { loggerOptions } from './lib/logger.js';
import { adminRoutes } from './modules/admin/routes.js';
import { registerAccessControl } from './modules/auth/access.js';
import { authRoutes } from './modules/auth/routes.js';
import { bookingRoutes } from './modules/bookings/routes.js';
import { notificationRoutes } from './modules/notifications/routes.js';
import { paymentRoutes } from './modules/payments/routes.js';
import { profileRoutes } from './modules/users/profile-routes.js';
import { smsRoutes } from './modules/sms/routes.js';
import { userRoutes } from './modules/users/routes.js';
import { ussdRoutes } from './modules/ussd/routes.js';
import { vetRoutes } from './modules/vets/routes.js';
import { healthRoutes } from './routes/health.js';
import { metaRoutes } from './routes/meta.js';

export interface AppOptions {
  logLevel: string;
  deps: DependencyCheck[];
  /** Database-backed services. Without it only the public health routes exist. */
  ctx?: AppContext;
  /** Called after the access-control hook is installed; tests use it to add probe routes. */
  extraRoutes?: (app: FastifyInstance) => void;
  /** Closed with the app (database pool, Redis client). */
  onClose?: () => Promise<void>;
  /** Log destination (tests capture logs to assert nothing sensitive is written). */
  logStream?: DestinationStream;
  /** Trusted proxy IPs/CIDRs (`TRUST_PROXY`); unset means `request.ip` is the socket address. */
  trustProxy?: string[] | undefined;
  /** Serve Swagger UI at /docs (never in production). The OpenAPI document is always built. */
  docs?: boolean;
  /** Oldest app version still supported (`GET /v1/meta/min-app-version`). */
  minAppVersion?: string;
  /** Africa's Talking callbacks must carry this as `?token=` (required in production). */
  webhookSecret?: string | undefined;
  /** Return SMS command replies in the webhook response (SMS_MODE=log, for the simulator). */
  echoSmsReplies?: boolean;
}

export const OPENAPI_INFO = {
  title: 'VetLink API',
  description:
    'REST API for the VetLink mobile and web apps. USSD, SMS and M-Pesa webhooks are not part ' +
    'of this document. Errors are `{ code, message_key, details }`; `message_key` maps into the ' +
    'shared i18n package.',
  version: '1.0.0',
};

export function buildApp({
  logLevel,
  deps,
  ctx,
  extraRoutes,
  onClose,
  logStream,
  trustProxy,
  docs = false,
  minAppVersion = '1.0.0',
  webhookSecret,
  echoSmsReplies = false,
}: AppOptions): FastifyInstance {
  const logger = loggerOptions(logLevel);
  const options: FastifyServerOptions = {
    logger: logStream ? { ...logger, stream: logStream } : logger,
  };
  if (trustProxy !== undefined) options.trustProxy = trustProxy;
  const app = Fastify(options);
  // Zod validates requests and serializes responses: a response is cut down to its declared
  // schema, so a field that is not in the schema can never leak to a client.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);
  // Africa's Talking posts form-encoded webhooks. Parsed here without a dependency.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string', bodyLimit: 16 * 1024 },
    (_req, body, done) => done(null, Object.fromEntries(new URLSearchParams(body as string))),
  );
  // Must run before any route is added: it rejects routes without an access declaration.
  registerAccessControl(app, ctx ?? null, { publicPrefixes: docs ? ['/docs'] : [] });

  void app.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: OPENAPI_INFO,
      components: {
        securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      },
    },
    transform: jsonSchemaTransform,
    transformObject: jsonSchemaTransformObject,
  });
  if (docs) void app.register(fastifySwaggerUi, { routePrefix: '/docs' });

  // Routes are registered after the swagger plugin so it sees them all.
  void app.register(async (api) => {
    healthRoutes(api, deps);
    metaRoutes(api, { minAppVersion });
    if (ctx) {
      authRoutes(api, ctx);
      userRoutes(api, ctx);
      profileRoutes(api, ctx);
      bookingRoutes(api, ctx);
      vetRoutes(api, ctx);
      notificationRoutes(api, ctx);
      adminRoutes(api, ctx);
      ussdRoutes(api, ctx, { webhookSecret });
      paymentRoutes(api, ctx, { webhookSecret });
      smsRoutes(api, ctx, { webhookSecret, echoReplies: echoSmsReplies });
    }
  });
  extraRoutes?.(app);
  app.addHook('onClose', async () => {
    await Promise.all(deps.map((d) => d.close()));
    await onClose?.();
  });
  return app;
}
