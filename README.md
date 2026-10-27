# VetLink

Connects Kenyan smallholder farmers with nearby verified veterinarians and paravets over USSD, SMS, a mobile app, and the web.

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
| Web end-to-end (Playwright) | `pnpm test:e2e` |

> [!WARNING]
> **`docker compose down -v` deletes the database, Redis, and storage volumes. All local data is lost.**
> Use plain `docker compose down` to stop the backend and keep your data.

## Local access map

| What | Where |
|---|---|
| API | `http://localhost:4000` (health at `/health`, readiness at `/ready`, Swagger UI at `/docs`, OpenAPI JSON at `/docs/json`; not served in production) |
| Web app (farmer, vet) | `http://localhost:3000` (`pnpm --filter web dev`) |
| Admin console | `http://localhost:3000/admin` (2FA required; seeded admin `0700000009`, TOTP secret printed by `db:seed`) |
| Mobile app | `pnpm --filter mobile start` (Expo), then an Android emulator or a dev build on a phone |
| Database (from host tools) | `localhost:5432` |
| Redis | `localhost:6379` |
| S3-compatible storage (SeaweedFS) | S3 API `http://localhost:8333`, file browser `http://localhost:8888` |
| Adminer | `http://localhost:8080` (`--profile tools`) |
| USSD / SMS / M-Pesa callbacks | Public tunnel URL → `/webhooks/*` |

Inside the Docker network the database host is `db`, Redis is `redis`, and storage is `s3:8333`.

## Web app

`apps/web` is one Next.js app for farmers, vets and admins (route groups `/farmer`, `/vet`, `/admin`). Run the backend with Docker, then `pnpm --filter web dev` and open `http://localhost:3000`. With `OTP_FIXED_CODE` set in `.env`, every login code is that value; otherwise the code is in `docker compose logs -f api` (`SMS_MODE=log`).

- **Same origin.** The browser only talks to the Next.js server. `/v1/*` is forwarded to `API_URL` (default `http://localhost:4000`), so there is no CORS and the API host is never exposed. `API_URL` is read when the app is **built** (rewrites are compiled in).
- **Session.** `/api/session/login|refresh|logout` keep the refresh token in an httpOnly, `SameSite=Strict` cookie scoped to `/api/session`; the access token lives only in memory. Refresh is single-flight per tab and across tabs (Web Locks), because the API revokes a session when a rotated refresh token is reused.
- **Guards are UX only.** `src/proxy.ts` and the client role guard send people to the right screen; the API authorizes every request.
- **Text and styling.** All text comes from `@vetlink/i18n` (`web` namespace, sw and en). Colours and sizes come from `@vetlink/ui-tokens` as CSS variables used by Tailwind.
- **Builds use webpack** (`next dev --webpack`, `next build --webpack`): the workspace packages are TypeScript source with NodeNext `./x.js` imports, which Turbopack cannot resolve.
- **Vet documents** are uploaded from the browser straight to storage with a presigned PUT. The production bucket needs a CORS rule allowing `PUT` from the web origin (local SeaweedFS allows it).

`pnpm test:e2e` builds the web app and runs Playwright against a throwaway database (from `TEST_DATABASE_URL`), the API and worker on port 4100 (fixed OTP, mock M-Pesa, logged SMS and push) and Redis index 14 (cleared at the start of each run), then removes the database. It covers the M11 happy path (farmer books and pays, vet accepts, travels, completes, farmer rates) and first-run onboarding. Chromium needs system libraries: `pnpm --filter web exec playwright install --with-deps chromium` (needs sudo), as CI does.

## Mobile app

`apps/mobile` is one Expo app (SDK 58, expo-router, Hermes) for farmers, vets and admins, with the same routes as the web app (`/farmer`, `/vet`, `/admin`). Android package and iOS bundle ID are the placeholder `co.ke.vetlink.dev` until M13.

- **Run it.** `docker compose up -d`, then `EXPO_PUBLIC_API_URL=http://10.0.2.2:4000 pnpm --filter mobile start` and press `a` for an Android emulator (`10.0.2.2` is the host from the emulator; use your machine's LAN IP for a phone). The app uses native modules (SQLite, SecureStore, notifications), so use `npx expo run:android` or an EAS preview build rather than Expo Go.
- **Offline-first (vets).** "On my way", "Arrived", completion notes and document uploads go to a SQLite outbox and are sent in order when the connection returns (on reconnect, on app foreground, every 30 s). A "waiting to send" badge shows what is queued. The server state machine wins: if the farmer cancelled meanwhile, the step fails and is shown. A step whose response was lost is not sent twice: a 409 makes the app re-read the booking.
- **Session.** The refresh token is in SecureStore (Keychain/Keystore); the access token is in memory. Refresh is single-flight; the app signs out only on a 401, not when offline.
- **Push.** Android channels `offers` (loud) and `default` are created at start. The permission is asked in context: when a vet first goes online, or after a farmer's first request. Registering a push token needs an EAS project ID (`extra.eas.projectId`, set up in M13); without it the app runs on SMS fallback.
- **Deep links.** `vetlink://booking/:id` opens the booking (as farmer or vet); tapped notifications use it too.
- **Checks here.** `pnpm --filter mobile test` (outbox offline-sync and session tests), `pnpm --filter mobile typecheck`, `pnpm --filter mobile bundle:android` (full Metro + Hermes bundle, also run in CI).
- **Device E2E (M12 done-when).** `apps/mobile/.maestro/happy-path.yaml` books as the seed farmer, accepts as the seed vet through the API, completes the job in airplane mode (outbox), then rates. Run it on an Android emulator: `maestro test apps/mobile/.maestro/happy-path.yaml -e API_URL=http://localhost:4000 -e OTP=123456` with the dev stack running and `OTP_FIXED_CODE=123456`.

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

## Payments (M-Pesa)

`PAYMENTS_MODE=mock` simulates M-Pesa. The payer's last digit picks the outcome: `…9` cancels, `…8` sends no callback (reconciliation settles it by query), `…7` cannot reach M-Pesa, and any other digit pays after about 3 s. Simulated callbacks go through the same worker job as real Daraja callbacks, so keep the `worker` container running. `sandbox`/`live` need `PUBLIC_BASE_URL`, `WEBHOOK_SECRET` and the `DARAJA_*` settings. Daraja calls `${PUBLIC_BASE_URL}/webhooks/mpesa?token=…`, which needs a public tunnel locally. Finance admins record refunds under `/v1/admin/payments`.

## Matching and notifications

Once a deposit is paid, the worker sends job offers in waves (closest, best-scored vets first; see §8.5). A vet receives offers only when approved and online (`PATCH /v1/vets/me/availability`). Offers and updates go out as app push when the user has the app (`PUSH_MODE=log` prints pushes locally), with an SMS fallback after 15 s, or by SMS when they have no app. With `SMS_MODE=log`, look for `VETLINK JOB` in `docker compose logs worker`. Super admins tune matching under `/v1/admin/config`.

## Vet applications and verification

A vet signs up, chooses Vet/Paravet, and fills the 7-step application (`/v1/vets/me/application/*`, autosaved per step). Documents go straight to private storage: `POST /v1/uploads/presign`, PUT the file to the returned URL, then confirm. Verifiers work the queue under `/v1/admin/vet-applications` (claim, then approve, request changes or reject; every step is audited, and the admin who assisted an applicant can never approve them). A vet gets no jobs until approved, and approval never puts them online. Presigned URLs use `S3_PUBLIC_ENDPOINT` (default `http://localhost:8333`; use the machine's LAN IP for a phone).

## SMS commands

Vets can run a job entirely by SMS (`Y4`, `OTW 4`, `ARR 4`, `DONE 4 ECF; oxytet 20ml; f/u 7d`, `ON`/`OFF`); farmers rate with `R4 5`. `pnpm --filter api sms:sim -- --phone 0700000002 "Y4"` sends one SMS to the running API and prints the reply. Commands and parsing rules: `docs/sms-commands.md`.

**End-to-end dev demo:** `pnpm ussd:sim` (book as the demo farmer, confirm). The mock pays after about 3 s and the worker offers the job to the demo vet (put them online first with `sms:sim -- --phone 0700000002 ON`). Then `sms:sim -- --phone 0700000002 "Y<ref>"`, `"OTW <ref>"`, `"ARR <ref>"`, `"DONE <ref> ECF; oxytet 20ml"`, and as the farmer `sms:sim -- --phone 0700000001 "R<ref> 5"`.

## USSD

`pnpm ussd:sim` walks the farmer USSD menu against the running API, as the seeded demo farmer (`-- --phone 07…` for another number). Menus and rules: `docs/ussd-flows.md`.

## Database

- Schema: `apps/api/src/db/schema/`. Migrations (committed SQL): `apps/api/src/db/migrations/`. Change the schema, run `db:generate`, review the SQL, commit it, then run `migrate`. Migrations are forward-only: never edit one that has been applied.
- `pnpm test` runs DB integration tests against `TEST_DATABASE_URL` (in `.env`). Each run creates and drops its own throwaway database, so your dev data is untouched. Without `TEST_DATABASE_URL` those tests are skipped. Redis-backed rate-limit tests use `TEST_REDIS_URL` (logical DB 15) the same way.
- **Logging in locally:** `POST /v1/auth/otp/request` with `{"phone":"07…"}`, read the code from the API logs, then `POST /v1/auth/otp/verify` with `{"phone","code","device":{"platform":"web"}}`. The seeded super admin then completes 2FA with `POST /v1/auth/2fa/verify` and a code from an authenticator app set up with the printed TOTP secret.
- The seed loads Kiambu's 60 wards (approximate sub-county coordinates, dev only), a demo farmer with a cow, an approved vet, a paravet with a submitted application, and a super admin. It prints the admin's TOTP secret for an authenticator app. Demo phone numbers are in `apps/api/src/db/seed/fixtures.ts`. The seed only runs against a local database (`localhost`, `127.0.0.1`, `[::1]` or the compose `db` host) and is not included in the production image.

## Dev-only shortcuts

`SMS_MODE=log` prints SMS and OTPs to the API logs (`docker compose logs api`, look for `SMS (SMS_MODE=log`), `OTP_FIXED_CODE` makes every login code the same, and `PAYMENTS_MODE=mock` simulates M-Pesa. The API **refuses to start** if any of them is on with `APP_ENV=production`. In production the API and worker also refuse to start, or exit if one appears later, when any dev seed account (including the seeded admin) exists in the database. The seed itself refuses to run unless `APP_ENV` is `development` or `test`.
