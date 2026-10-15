# Docker and Environments

> Part of the VetLink spec. Process rules, commands, guardrails, and the progress tracker are in `/CLAUDE.md`. Section numbers (for example 8.5 or 13) are stable across all spec files; find the file for a section with the map in `/CLAUDE.md` section 0.1 or `docs/spec/README.md`.

## 6. Repository Structure and Environments (Docker part)

The repo tree and monorepo notes are in `/CLAUDE.md` section 6. This file holds section 6.1.

### 6.1 Docker setup and local development

> **Superseded detail (2026-10-15):** local object storage is **SeaweedFS** (compose service `s3`, S3 API `localhost:8333`, file browser `localhost:8888`), not MinIO, because the `minio/minio` image is no longer published. The dev `api`/`worker` services run `tsx` directly with `init: true` (see the decision log in `/CLAUDE.md`). The committed `docker-compose.yml` is authoritative.

**Decision: the backend runs in Docker, in development and in production.** One `docker compose up` gives every developer (and Claude Code) the same API, worker, database, Redis, and object storage.

**What runs where**

| Component | Local dev | Production |
|---|---|---|
| API (Fastify) | Docker (`api`) | Docker container (image built in CI) |
| Worker (BullMQ jobs) | Docker (`worker`, same image as API) | Docker container |
| PostgreSQL | Docker (`db`, named volume) | **Managed PostgreSQL**, not a container we run ourselves |
| Redis | Docker (`redis`, named volume) | Managed Redis, or a container with persistence (AOF) |
| Object storage (photos, vet documents) | Docker (`minio`, S3-compatible) | S3-compatible cloud bucket |
| Web app (Next.js) | **Host** (`pnpm --filter web dev`) | Container or static/edge host (decide later) |
| Mobile app (Expo) | **Host** (`pnpm --filter mobile start`) | EAS builds to the app stores |
| Adminer (DB viewer) | Docker, `tools` profile only | Never deployed |

Expo stays on the host because it needs direct access to emulators/phones and fast refresh. Next.js can also run on the host for speed.

**`docker-compose.yml` (local dev), pin exact image tags when scaffolding:**
```yaml
name: vetlink

services:
  db:
    image: postgres:16-alpine        # use postgis/postgis:16-3.4 if PostGIS is needed
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: ${DB_NAME}
      TZ: UTC
    ports:
      - "127.0.0.1:5432:5432"        # bound to localhost only, never 0.0.0.0
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER} -d ${DB_NAME}"]
      interval: 5s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes"]
    ports:
      - "127.0.0.1:6379:6379"
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

  minio:                             # local S3-compatible storage for uploads
    image: minio/minio               # pin a release tag
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${S3_ACCESS_KEY}
      MINIO_ROOT_PASSWORD: ${S3_SECRET_KEY}
    ports:
      - "127.0.0.1:9000:9000"        # S3 API
      - "127.0.0.1:9001:9001"        # web console
    volumes:
      - miniodata:/data

  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
      target: dev
    env_file: .env
    environment:
      DATABASE_URL: postgres://${DB_USER}:${DB_PASSWORD}@db:5432/${DB_NAME}
      REDIS_URL: redis://redis:6379
      S3_ENDPOINT: http://minio:9000
    ports:
      - "4000:4000"
    depends_on:
      db: { condition: service_healthy }
      redis: { condition: service_healthy }
    volumes:
      - ./apps/api/src:/app/apps/api/src     # hot reload
      - ./packages:/app/packages
    command: pnpm --filter api dev

  worker:                            # same image, runs queue workers and schedulers
    build:
      context: .
      dockerfile: apps/api/Dockerfile
      target: dev
    env_file: .env
    environment:
      DATABASE_URL: postgres://${DB_USER}:${DB_PASSWORD}@db:5432/${DB_NAME}
      REDIS_URL: redis://redis:6379
      S3_ENDPOINT: http://minio:9000
    depends_on:
      db: { condition: service_healthy }
      redis: { condition: service_healthy }
    volumes:
      - ./apps/api/src:/app/apps/api/src
      - ./packages:/app/packages
    command: pnpm --filter api worker

  migrate:                           # one-off: docker compose run --rm migrate
    profiles: ["tools"]
    build:
      context: .
      dockerfile: apps/api/Dockerfile
      target: dev
    env_file: .env
    environment:
      DATABASE_URL: postgres://${DB_USER}:${DB_PASSWORD}@db:5432/${DB_NAME}
    depends_on:
      db: { condition: service_healthy }
    command: pnpm --filter api db:migrate

  adminer:                           # DB viewer: http://localhost:8080
    profiles: ["tools"]
    image: adminer
    ports:
      - "127.0.0.1:8080:8080"
    depends_on:
      - db

volumes:
  pgdata:
  redisdata:
  miniodata:
```

**`apps/api/Dockerfile` (build context is the repo root):**
```dockerfile
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/i18n/package.json packages/i18n/
# add every workspace package the API imports
RUN pnpm install --frozen-lockfile

FROM deps AS dev
COPY . .
EXPOSE 4000
CMD ["pnpm", "--filter", "api", "dev"]

FROM deps AS build
COPY . .
RUN pnpm --filter api build && pnpm deploy --filter api --prod /out
# verify the deployed bundle includes dist, or switch to `turbo prune --docker`

FROM node:20-alpine AS prod
ENV NODE_ENV=production TZ=UTC
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /out ./
USER app
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:4000/health || exit 1
CMD ["node", "dist/server.js"]
```

**Docker rules**
- Same image for `api` and `worker`; only the command differs.
- Production image: multi-stage, non-root user, production dependencies only, **no secrets baked in** (inject at runtime), `.dockerignore` excludes `node_modules`, `.env`, `.git`, and build output.
- Two endpoints: `GET /health` (process alive) and `GET /ready` (DB and Redis reachable). Compose and the host's orchestrator use them.
- **Graceful shutdown on SIGTERM:** finish in-flight requests, stop accepting jobs, let running jobs complete or requeue. Critical for payments and dispatch waves.
- Logs go to stdout as structured JSON (pino); never to files inside the container.
- Containers run in UTC; the app converts to Africa/Nairobi for display.
- **Migrations are a separate step**, run before a new API version starts (`migrate` service locally, a CI/CD step in production). The API never auto-migrates in production.
- Inside the Docker network the database host is `db`; from the host machine (DBeaver, Drizzle Studio) it is `localhost`. Keep two connection strings if needed.
- `docker compose down` keeps data; **`docker compose down -v` deletes the database volume.** Document this loudly in the README.
- Ports bind to `127.0.0.1` for data services so they are not reachable from other machines on the network.

**Dev conveniences (must be impossible to enable in production; assert on startup):**
- `SMS_MODE=log`: outbound SMS and OTPs are printed to the API logs instead of being sent (no cost, no real numbers). Values: `log | sandbox | live`.
- `PAYMENTS_MODE=mock`: simulates STK push success/failure/timeout locally. Values: `mock | sandbox | live`.
- `OTP_FIXED_CODE`: optional 6-digit code that every OTP login uses. Empty means random codes.
- With `SMS_MODE=log`, codes appear in the logs only when `APP_ENV` is `development` or `test`; elsewhere (staging) they are masked, so use `OTP_FIXED_CODE` there.
- **Seed data:** demo farmer, approved vet, pending vet application, and an admin (with a known TOTP secret printed by the seed script so an authenticator app can be set up), plus one county's wards.
- **Local USSD simulator:** a dev-only script/page (`pnpm ussd:sim`) that posts to `/webhooks/ussd` like Africa's Talking, so the USSD flow can be tested without the real network.
- **Public URL for webhooks:** Africa's Talking and Daraja need to reach the API over HTTPS. In dev use a tunnel (ngrok or Cloudflare Tunnel) and set `PUBLIC_BASE_URL`.

**`.env.example` (placeholders only):** `APP_ENV`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET` (at least 32 characters; refresh tokens are opaque and hashed, so they need no secret), `DATA_ENCRYPTION_KEY`, `TEST_DATABASE_URL`, `TEST_REDIS_URL`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `AT_API_KEY`, `AT_USERNAME`, `AT_SENDER_ID`, `DARAJA_CONSUMER_KEY`, `DARAJA_CONSUMER_SECRET`, `DARAJA_SHORTCODE`, `DARAJA_PASSKEY`, `PUBLIC_BASE_URL`, `SMS_MODE`, `PAYMENTS_MODE`, `OTP_FIXED_CODE`, `TRUST_PROXY` (production: the reverse proxy's IPs/CIDRs, never a hop count), `MAPS_API_KEY`, `SENTRY_DSN`.

**Local access map (default ports):**

| What | Where |
|---|---|
| API | `http://localhost:4000` (API docs at `/docs`, health at `/health`) |
| Web app (farmer, vet) | `http://localhost:3000` |
| Admin console | `http://localhost:3000/admin` |
| Mobile app | Expo dev server: scan QR (Expo Go / dev build) or Android emulator |
| Database (from host tools) | `localhost:5432` |
| Adminer | `http://localhost:8080` (`--profile tools`) |
| MinIO console | `http://localhost:9001` |
| USSD / SMS / M-Pesa callbacks | Public tunnel URL → `/webhooks/*` |

**Production (summary):**
- CI builds the `prod` image and pushes it to a registry (e.g. GHCR). The server pulls and runs it with `docker-compose.prod.yml` (API and worker behind a reverse proxy such as Caddy or Traefik with automatic HTTPS), or a managed container platform.
- Database is a **managed PostgreSQL** instance, reachable only from the API/worker, with automated backups and tested restores. Redis managed or persistent.
- Separate staging and production environments with separate secrets; staging mirrors production.
- Set container restart policies, resource limits, and log shipping/alerts.
