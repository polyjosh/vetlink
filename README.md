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
docker compose up -d          # api, worker, db, redis, s3 (SeaweedFS)
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
| API | `http://localhost:4000` (health at `/health`, readiness at `/ready`, API docs at `/docs` from M5) |
| Web app (farmer, vet) | `http://localhost:3000` (from M11) |
| Admin console | `http://localhost:3000/admin` (from M11) |
| Mobile app | Expo dev server: scan the QR code (Expo Go or a dev build) or use an Android emulator (from M12) |
| Database (from host tools) | `localhost:5432` |
| Redis | `localhost:6379` |
| S3-compatible storage (SeaweedFS) | S3 API `http://localhost:8333`, file browser `http://localhost:8888` |
| Adminer | `http://localhost:8080` (`--profile tools`) |
| USSD / SMS / M-Pesa callbacks | Public tunnel URL → `/webhooks/*` |

Inside the Docker network the database host is `db`, Redis is `redis`, and storage is `s3:8333`.

## Dev-only shortcuts

`SMS_MODE=log` prints SMS and OTPs to the API logs, and `PAYMENTS_MODE=mock` simulates M-Pesa. The API **refuses to start** if either is on with `APP_ENV=production`.
