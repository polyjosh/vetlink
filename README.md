# VetLink

Connects Kenyan smallholder farmers with nearby verified veterinarians and paravets over USSD, SMS, a mobile app, and the web.

- Project guide, process rules, and progress tracker: [`CLAUDE.md`](CLAUDE.md)
- Detailed spec: [`docs/spec/`](docs/spec/README.md)

## Prerequisites

- Node.js 24 LTS and pnpm 12.11.2 (`npm install -g pnpm@12.11.2`)
- Docker with Compose v2
- On Windows: run everything inside **WSL2**, with the repo in the Linux filesystem (not `/mnt/c`) and Docker Desktop's WSL integration on.

## Local setup

```bash
pnpm install
cp .env.example .env          # dev placeholders; never commit .env
echo "DATA_ENCRYPTION_KEY=$(openssl rand -base64 32)" >> .env   # field-encryption key
echo "JWT_SECRET=$(openssl rand -base64 32)" >> .env            # access-token signing key
docker compose up -d          # api, worker, db, redis, s3 (SeaweedFS)
docker compose run --rm migrate
pnpm --filter api db:seed     # demo users + Kiambu wards; safe to re-run
curl http://localhost:4000/health
curl http://localhost:4000/ready
```

## Everyday commands

| Purpose | Command |
|---|---|
| Start backend | `docker compose up -d` |
| Stop backend (keeps data) | `docker compose down` |
| Backend logs | `docker compose logs -f api` (or `worker`) |
| Rebuild after dependency changes | `docker compose build api worker` |
| Run migrations | `docker compose run --rm migrate` |
| Generate a migration from schema changes | `pnpm --filter api db:generate` |
| Seed dev data (idempotent) | `pnpm --filter api db:seed` |
| Drizzle Studio (host) | `pnpm --filter api db:studio` |
| DB viewer (Adminer) | `docker compose --profile tools up -d adminer` |
| psql shell | `docker compose exec db psql -U $DB_USER -d $DB_NAME` |
| Lint / typecheck / tests | `pnpm lint` / `pnpm typecheck` / `pnpm test` |
| Full pre-commit check | `pnpm check` |

> [!WARNING]
> **`docker compose down -v` deletes the database, Redis, and storage volumes. All local data is lost.**
> Use plain `docker compose down` to stop the backend and keep your data.

## Local access map

| What | Where |
|---|---|
| API | `http://localhost:4000` (health at `/health`, readiness at `/ready`, Swagger UI at `/docs`, OpenAPI JSON at `/docs/json`; not served in production) |
| Web app (farmer, vet) | `http://localhost:3000` (from M11) |
| Admin console | `http://localhost:3000/admin` (from M11) |
| Mobile app | Expo dev server: scan the QR code (Expo Go or a dev build) or use an Android emulator (from M12) |
| Database (from host tools) | `localhost:5432` |
| Redis | `localhost:6379` |
| S3-compatible storage (SeaweedFS) | S3 API `http://localhost:8333`, file browser `http://localhost:8888` |
| Adminer | `http://localhost:8080` (`--profile tools`) |
| USSD / SMS / M-Pesa callbacks | Public tunnel URL → `/webhooks/*` |

Inside the Docker network the database host is `db`, Redis is `redis`, and storage is `s3:8333`.

## API and typed client

Every route declares zod schemas for its body, params, query and responses. They validate requests, serialize responses (a field not in the schema is never sent), and generate the OpenAPI document. Mobile and web call the API only through `@vetlink/api-client`:

```ts
import { createApiClient, newIdempotencyKey } from '@vetlink/api-client';

const api = createApiClient({ baseUrl, channel: 'web', getAccessToken: () => token });
const { data, error } = await api.POST('/v1/bookings', {
  params: { header: { 'idempotency-key': newIdempotencyKey() } }, // generate on tap, reuse on retry
  body: { species: 'cattle', problemType: 'sick' },
});
```

After changing a route or schema, run `pnpm api:generate` and commit `packages/api-client/openapi.json` and `src/schema.ts`. A test and a CI step fail if they are stale.

## USSD

`pnpm ussd:sim` walks the farmer USSD menu against the running API, as the seeded demo farmer (`-- --phone 07…` for another number). Menus and rules: `docs/ussd-flows.md`.

## Database

- Schema: `apps/api/src/db/schema/`. Migrations (committed SQL): `apps/api/src/db/migrations/`. Change the schema, run `db:generate`, review the SQL, commit it, then run `migrate`. Migrations are forward-only: never edit one that has been applied.
- `pnpm test` runs DB integration tests against `TEST_DATABASE_URL` (in `.env`). Each run creates and drops its own throwaway database, so your dev data is untouched. Without `TEST_DATABASE_URL` those tests are skipped. Redis-backed rate-limit tests use `TEST_REDIS_URL` (logical DB 15) the same way.
- **Logging in locally:** `POST /v1/auth/otp/request` with `{"phone":"07…"}`, read the code from the API logs, then `POST /v1/auth/otp/verify` with `{"phone","code","device":{"platform":"web"}}`. The seeded super admin then completes 2FA with `POST /v1/auth/2fa/verify` and a code from an authenticator app set up with the printed TOTP secret.
- The seed loads Kiambu's 60 wards (approximate sub-county coordinates, dev only), a demo farmer with a cow, an approved vet, a paravet with a submitted application, and a super admin. It prints the admin's TOTP secret for an authenticator app. Demo phone numbers are in `apps/api/src/db/seed/fixtures.ts`. The seed only runs against a local database (`localhost`, `127.0.0.1`, `[::1]` or the compose `db` host) and is not included in the production image.

## Dev-only shortcuts

`SMS_MODE=log` prints SMS and OTPs to the API logs (`docker compose logs api`, look for `SMS (SMS_MODE=log`), `OTP_FIXED_CODE` makes every login code the same, and `PAYMENTS_MODE=mock` simulates M-Pesa. The API **refuses to start** if any of them is on with `APP_ENV=production`. In production the API and worker also refuse to start, or exit if one appears later, when any dev seed account (including the seeded admin) exists in the database. The seed itself refuses to run unless `APP_ENV` is `development` or `test`.
