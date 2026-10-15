# VetLink: CLAUDE.md (Project Guide for Claude Code)

> This file is loaded at the start of every Claude Code session in this repo. It is deliberately lean: **process rules, commands, guardrails, the progress tracker, and the core rules live here; the detailed spec lives in `docs/spec/` and is read on demand** (map in 0.1). Section 0 takes precedence for *how* to work; the spec files define *what* to build. If a request conflicts with this file or the spec, say so and ask before proceeding. Update these files when decisions change.

---

## 0. Claude Code Operating Manual

### 0.1 Project status and spec map

- **Greenfield.** The repo starts empty apart from this file and `docs/`. Nothing below exists until it is built. Never assume a file, script, or dependency exists; check first.
- Check the **progress tracker (0.8)** at the start of every session to see what is done and what is next.
- **This file is deliberately lean.** The detailed spec lives in `docs/spec/` and is **read on demand**. Before planning a task, read the spec files listed for it in the tracker (0.8) or in the map below. Load only what the task needs; do not load every file, and do not work from memory.
- Section numbers (8.5, 13, and so on) are stable across all files. A reference such as "see 8.3" means look it up using the map.

**Spec map**

| File | Contains | Read when |
|---|---|---|
| `docs/spec/00-claude-code-setup.md` | Claude Code config: `settings.json`, slash commands | Milestone 0, or when changing Claude Code config |
| `docs/spec/01-product-and-channels.md` | §2 channels and parity matrix, §3 users, §7 glossary | Any feature spanning USSD, SMS, app, and web; unsure who uses what |
| `docs/spec/02-docker-and-environments.md` | §6.1 Docker, compose, Dockerfile, env vars, dev shortcuts, local access map, production summary | Docker, env vars, CI/CD, deploy, local setup |
| `docs/spec/03-auth-and-roles.md` | §8.0 login, role routing, admin permissions | Auth, roles, route guards, admin access |
| `docs/spec/04-farmer-flows.md` | §8.1 USSD flow, §8.2 farmer app and web flow | USSD, farmer screens, booking creation |
| `docs/spec/05-vet-flows-and-onboarding.md` | §8.3 vet app flow plus onboarding and verification, §8.4 SMS commands | Anything vet-related, verification gating, SMS parser |
| `docs/spec/06-matching-payments-notifications.md` | §8.5 matching, §8.6 payments, §8.7 notifications, §8.8 reminders, §8.9 outbreaks | Dispatch, M-Pesa, push/SMS routing, reminders |
| `docs/spec/07-data-model.md` | §9 schema and booking state machine | Any database, schema, or migration work |
| `docs/spec/08-api.md` | §10 API design, endpoints, idempotency | New or changed endpoints, OpenAPI |
| `docs/spec/09-clients-mobile-web-admin.md` | §11 mobile app, §12 web app, §13 admin console | Expo app, Next.js app, admin UI |
| `docs/spec/10-integrations.md` | §14 Africa's Talking, Daraja, push, maps, storage | Third-party integration work |
| `docs/spec/11-testing.md` | §16 testing requirements | Writing tests, judging whether work is done |
| `docs/spec/12-security-privacy.md` | §17 security, privacy, compliance | Auth, PII, vet documents, data protection, anything sensitive |
| `docs/spec/13-store-release.md` | §18 App Store and Play Store release | Store submission and release |
| `docs/spec/14-roadmap-metrics-open-questions.md` | §19 roadmap, §20 metrics, **§21 open questions** | Planning, or before any decision touching money, verification policy, hosting, or store IDs |

### 0.2 Operating protocol for every task

Follow this loop. Do not skip steps.

1. **Orient.** Read the tracker, then read the spec files for this task (map in 0.1) before planning. State in 1 to 2 lines what you are about to do and which modules and channels it touches.
2. **Explore.** Read the existing code you will touch. Do not write code yet.
3. **Plan.** Write a short plan: files to create or change, schema/API changes, tests, risks, and any Open Questions that block you. **Stop and wait for approval** if the task touches any of: database schema, auth/roles, payments, matching, vet verification, store compliance, or more than about 8 files. For small, low-risk changes, state the plan and proceed.
4. **Implement** in small steps. One concern per commit.
5. **Verify.** Run the checks (`pnpm check`, plus any task-specific commands) and **show the real output**. Never claim something works without running it. If something cannot be run here (needs a physical device, public webhook, real M-Pesa), say so explicitly and say how the owner can verify it.
6. **Report.** Summarize what changed, what was tested, what was not, and what is next.
7. **Update the tracker** (0.8) and the decision log (0.10) if anything was decided. Then commit.

**When information is missing:**
- *Ask* about money, consent, verification policy, legal/store compliance, anything in the Open Questions (section 21), and any decision that is expensive to reverse (app ID, schema shape, hosting).
- *Assume and state the assumption* for small, reversible details. Put the assumption in your report.
- Never invent API endpoints, library options, or version numbers from memory. **Look them up** (package registry, official docs, `--help`) and pin exact versions.

### 0.3 Guardrails (non-negotiable)

**Never do these without explicit approval from the owner in this session:**
- Delete data or volumes: `docker compose down -v`, `docker volume rm`, `DROP`/`TRUNCATE`, mass `DELETE`.
- Destructive filesystem or git operations: `rm -rf` outside build output, `git reset --hard`, `git push --force`, rewriting history, deleting branches.
- Edit or delete an **applied** migration. Fix forward with a new migration.
- Run anything against a **production** or **staging** environment.
- Install a new dependency (state package, version, why, and size impact for mobile, then wait).
- Change the licence, CI secrets, store identifiers (bundle ID / package name), or money logic without a plan approved first.

**Always:**
- Keep secrets out of the repo. Never read, print, or commit `.env` or real credentials. Use `.env.example` with placeholders.
- Do not push to a remote unless asked. Commit locally on a task branch.
- Mask phone numbers (`2547****123`) in logs, tests, fixtures, and examples. Use obviously fake numbers in seeds.
- Add `sw` and `en` strings together. No hardcoded user-facing text.
- Enforce authorization on the server for every route (section 15). Never trust the client.
- Treat dev-only shortcuts (`SMS_MODE=log`, `PAYMENTS_MODE=mock`, seeded admin, fixed OTP) as dangerous: they must fail startup if enabled when `APP_ENV=production`.

### 0.4 Canonical commands

These are the only commands to document and use. **If a script does not exist yet, create it with exactly this name** (Milestone 1) rather than inventing a different one.

| Purpose | Command |
|---|---|
| Install deps | `pnpm install` |
| Start backend (api, worker, db, redis, minio) | `docker compose up -d` |
| Stop backend (keeps data) | `docker compose down` |
| Backend logs | `docker compose logs -f api` (or `worker`) |
| Rebuild after dependency changes | `docker compose build api worker` |
| Run migrations | `docker compose run --rm migrate` |
| Generate a migration from schema changes | `pnpm --filter api db:generate` |
| Seed dev data | `pnpm --filter api db:seed` |
| DB viewer (Adminer) | `docker compose --profile tools up -d adminer` |
| Drizzle Studio (host) | `pnpm --filter api db:studio` |
| psql shell | `docker compose exec db psql -U $DB_USER -d $DB_NAME` |
| Lint | `pnpm lint` |
| Typecheck | `pnpm typecheck` |
| Tests (all) | `pnpm test` |
| Tests (API only / watch) | `pnpm --filter api test` / `pnpm --filter api test:watch` |
| **Full pre-commit check** | `pnpm check` (lint + typecheck + test) |
| Regenerate OpenAPI + typed client | `pnpm api:generate` |
| Web dev server | `pnpm --filter web dev` |
| Mobile dev server (Expo) | `pnpm --filter mobile start` |
| Local USSD simulator | `pnpm ussd:sim` |
| Health check | `curl http://localhost:4000/health` and `/ready` |

**Tool decisions already made:** pnpm workspace + Turborepo, TypeScript strict, Fastify, **Drizzle** for ORM and migrations, Vitest, BullMQ, Expo (React Native), Next.js. Do not switch without asking.

**Environment note:** if the owner is on Windows, run everything inside **WSL2** (repo in the Linux filesystem, not `/mnt/c`), with Docker Desktop's WSL integration on. Verify tool versions (`node -v`, `pnpm -v`, `docker --version`) at the start of Milestone 1 and report them.

### 0.5 Git workflow

- One branch per task: `feat/<module>-<short-desc>`, `fix/...`, `chore/...`. Never commit to `main` directly.
- Conventional commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`). Small, reviewable commits.
- Run `pnpm check` before every commit. Do not commit failing tests, commented-out code, or debug logging.
- `.gitignore` must include: `.env`, `.env.*` (except `.env.example`), `node_modules`, `dist`, `.next`, `.expo`, `coverage`, `.turbo`, `.claude/settings.local.json`, OS/editor junk.
- Each PR/branch summary lists: what changed, how to verify locally, migrations included (yes/no), spec sections touched, and any new Open Questions.

### 0.6 Context hygiene (how we keep sessions effective)

- **One milestone or task per session.** Use `/clear` between unrelated tasks.
- Use `/compact` with a focus when a session gets long (e.g. "keep the plan, files changed, and failing tests").
- For broad exploration ("where is X handled?"), delegate to a subagent/search instead of reading many files into the main context.
- State survives sessions through **this file**: the tracker (0.8), the decision log (0.10), and committed code. Update them as you go.
- Prefer showing diffs and test output over pasting whole files.

### 0.7 Claude Code project configuration

Create `.claude/settings.json` (shared permissions: allow safe dev commands, deny destructive ones) and the slash commands `/task`, `/verify`, `/review`, `/update-tracker` in **Milestone 0**, using `docs/spec/00-claude-code-setup.md`. Keep `.claude/settings.local.json` for personal overrides (gitignored). Verify rule syntax against the current Claude Code docs, since it evolves.

### 0.8 Progress tracker

Tick items as they are completed and verified. Each milestone has a **Done when** condition and a **Read** list. Read those spec files before planning (not from memory). Do not start a milestone until the previous one's **Done when** is true, unless the owner says otherwise. Owner prompts for starting sessions are in `docs/kickoff-prompts.md`.

- [x] **M0: Repo and Claude Code setup.** *(2026-10-15, `main`)* `git init`, `.gitignore`, `.claude/settings.json`, slash commands, README stub. *Done when:* repo committed on `main`, config files exist, `/task` appears as a command. **Read:** `00-claude-code-setup.md`.
- [ ] **M1: Scaffold and Docker.** pnpm + Turborepo monorepo, `apps/api` skeleton with `/health` and `/ready`, `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `.env.example`, root scripts from 0.4, CI that builds the image, README with the local access map. *Done when:* `docker compose up -d` starts everything healthy, `curl localhost:4000/health` returns OK, `pnpm check` is green. **Read:** `02-docker-and-environments.md`.
- [ ] **M2: Database.** Drizzle schema for the data model, first migration, `db:seed` with demo users and one county's wards. *Done when:* `docker compose run --rm migrate` creates all tables from a clean volume and the seed runs twice without errors. **Read:** `07-data-model.md`, `12-security-privacy.md`.
- [ ] **M3: Auth and roles.** OTP request/verify (`SMS_MODE=log`), JWT + refresh rotation, devices, role claims and guards, admin TOTP 2FA and step-up. *Done when:* the auth and authorization tests pass. **Read:** `03-auth-and-roles.md`, `08-api.md`, `12-security-privacy.md`, `11-testing.md`.
- [ ] **M4: Booking service.** Channel-agnostic service and the single transition function; `bookings` and `booking_offers` flows. *Done when:* state machine tests pass, including invalid transitions. **Read:** `07-data-model.md`, `06-matching-payments-notifications.md`, `08-api.md`.
- [ ] **M5: OpenAPI and typed client.** Schemas to OpenAPI, `/docs`, generated `packages/api-client`. *Done when:* `pnpm api:generate` is clean and the client compiles. **Read:** `08-api.md`.
- [ ] **M6: USSD.** Engine, language and main menu, booking flow, `pnpm ussd:sim`. *Done when:* table-driven tests pass in sw and en and a booking can be made through the simulator. **Read:** `04-farmer-flows.md`, `01-product-and-channels.md`.
- [ ] **M7: Payments.** STK push abstraction with `PAYMENTS_MODE=mock|sandbox`, idempotent callbacks, reconciliation job. *Done when:* duplicate, late, failed, and stuck payment tests pass. **Read:** `06-matching-payments-notifications.md` (8.6), `10-integrations.md`.
- [ ] **M8: Matching and notifications.** Eligibility (approved vets only), scoring, waves, BullMQ timeouts, notification router (push then SMS). *Done when:* matching, race, and fallback tests pass. **Read:** `06-matching-payments-notifications.md`, `05-vet-flows-and-onboarding.md` (gating), `10-integrations.md`.
- [ ] **M9: SMS vet commands.** Parser and flows (Y/N/OTW/ARR/DONE/ON/OFF/HELP). *Done when:* parser tests pass and **the end-to-end dev demo works: book through the USSD simulator, a vet accepts by SMS command, completes the job, the farmer rates it.** First demoable milestone. **Read:** `05-vet-flows-and-onboarding.md` (8.4), `06-matching-payments-notifications.md`.
- [ ] **M10: Vet application and admin verification.** Application draft/submit/resubmit backend, verification gating everywhere, admin queue and decisions with audit log. *Done when:* the gating tests pass and an unapproved vet can never receive an offer. **Read:** `05-vet-flows-and-onboarding.md` (8.3), `07-data-model.md`, `09-clients-mobile-web-admin.md` (13), `12-security-privacy.md`.
- [ ] **M11: Web app.** Role router and guards, vet onboarding wizard and status screen, farmer flows, vet flows, admin console routes. *Done when:* the Playwright happy path (farmer books, vet accepts, job completes) passes. **Read:** `03-auth-and-roles.md`, `04-farmer-flows.md`, `05-vet-flows-and-onboarding.md`, `09-clients-mobile-web-admin.md`.
- [ ] **M12: Mobile app.** Auth and role router, vet onboarding wizard (camera, background upload), farmer flows, vet job flow with offline outbox and push, admin essentials (lazy-loaded). *Done when:* the Maestro happy path passes on an Android emulator and the offline sync test passes. **Read:** `09-clients-mobile-web-admin.md` (11), `03-auth-and-roles.md`, `04-farmer-flows.md`, `05-vet-flows-and-onboarding.md`.
- [ ] **M13: Store and production readiness.** Account deletion, privacy labels, reviewer demo accounts, release checklist, production compose and CI/CD, staging, backups tested. *Done when:* `docs/store-release-checklist.md` is fully ticked. **Read:** `13-store-release.md`, `12-security-privacy.md`, `02-docker-and-environments.md`.

### 0.9 Owner prompts

The owner starts sessions with the prompts in `docs/kickoff-prompts.md` (empty-repo start, later milestones, bug fixes, pre-merge review).

### 0.10 Decision log

Record decisions here so future sessions inherit them. Format: `YYYY-MM-DD: decision. Reason.`

- 2026-10-15: One app (mobile + web) for farmer, vet, and admin with role-based routing. Simpler stores, shared code, one login.
- 2026-10-15: Backend runs in Docker (api, worker, Postgres, Redis, MinIO) locally; managed Postgres in production.
- 2026-10-15: Drizzle is the ORM; pnpm + Turborepo monorepo; Expo and Next.js dev servers run on the host.
- 2026-10-15: Vets receive no requests until an admin approves their application; enforced server-side in matching, availability, accept, and SMS.
- 2026-10-15: Default branch is `main` (renamed from `master`); M0 committed directly on `main` as the one bootstrap exception to 0.5. Required by the M0 done-when.
- 2026-10-15: `.claude/settings.json` denies reading `.env`, `.env.local`, `.env.*.local`, `.env.production`, `.env.staging` instead of `.env.*`. The broad pattern also blocked `.env.example`.

### 0.11 Quality bar

- Production-minded from day one: validation at boundaries, idempotency on money and booking creation, graceful shutdown, structured logs without PII, tests for the unhappy paths (retries, duplicates, timeouts, races, offline).
- Prefer boring, well-understood solutions and small dependencies, especially in the mobile bundle.
- If you find a spec problem, contradiction, or risk, raise it with a proposed fix instead of working around it silently.

---

## Core Spec (always applies)

The sections below are the rules that apply to every task. Everything else is in `docs/spec/`.

## 1. Mission

VetLink connects Kenyan smallholder farmers with nearby veterinarians and animal health workers (paravets), and builds a lasting health record for their animals.

**North-star outcome:** a farmer with a sick animal reaches a verified vet in under 2 minutes, from any phone, whether a feature phone with no data or a smartphone with the app.

**Non-goals (for now):** e-commerce for drugs, telemedicine video, livestock trading, insurance. Do not build these unless asked.

### Core invariants (never violate)

1. **The phone number is the account.** One login (SMS OTP) for farmers, vets, and admins; users are routed by role after login. One app (mobile and web) for all three roles.
2. **A vet receives no farmer request until an admin approves their application** (`verification_status = 'approved'`). Enforced on the server in matching, availability, offer acceptance, and SMS commands, never only in the UI.
3. **Booking status changes only through the transition function** (`bookings/transitions.ts`), from every channel.
4. **Money is idempotent.** The client never marks a payment successful or sets a price. Payment callbacks are untrusted, may arrive late or twice, and are reconciled.
5. **Authorization is enforced on the server for every route.** Admin routes need the admin role, a satisfied 2FA session, and the specific permission. Client route guards are UX only.
6. **Channel parity:** anything a farmer can do on USSD must also work in the app and on web, but not the reverse.
7. **Swahili and English together.** All user-facing text through the shared i18n package; no hardcoded strings in any channel.
8. **Privacy:** phone numbers masked in logs; vet identity documents and national IDs are highly sensitive and visible only to verifiers and super admins.
9. **Dev-only shortcuts** (`SMS_MODE=log`, `PAYMENTS_MODE=mock`, seeded admin, fixed OTP) must fail startup if enabled when `APP_ENV=production`.
10. **API changes:** update the zod schemas and OpenAPI, regenerate the typed client, and stay backward compatible with released app versions.
11. **Design for low-end Android and poor connectivity first.** Check that a change in one channel does not break the others.

## 4. Design Principles

1. **Feature phone first, app second.** The USSD/SMS path must never be a second-class citizen.
2. **Swahili and English everywhere.** All user-facing strings live in the shared i18n package. No hardcoded strings in any channel.
3. **Low data, low literacy, low-end hardware.** Short menus, icons plus words, big tap targets, small bundles.
4. **Offline tolerant.** Assume dropped sessions, delayed callbacks, duplicate webhooks, and vets working in dead zones.
5. **Money is sacred.** Every payment is idempotent, logged, and reconcilable.
6. **Trust is the product.** Only verified vets receive jobs. Fees are transparent before commitment.
7. **One brain, many adapters.** Business logic lives in backend services. Channels never contain business rules.
8. **Measure supply gaps.** Log every offer, response, and timeout. That data drives growth.

## 5. Tech Stack

| Concern | Choice | Notes |
|---|---|---|
| Language | TypeScript everywhere (Node 20+) | Strict mode on |
| Backend | Fastify + zod schemas | REST, OpenAPI auto-generated from schemas |
| DB | PostgreSQL 15+ | PostGIS added when geo queries need it |
| ORM / migrations | Drizzle (preferred) or Prisma; pick one, then stay | SQL migrations committed |
| Queue / jobs | BullMQ + Redis | Offer timeouts, reminders, retries, notifications |
| Realtime | Server-Sent Events (web) + push (mobile) + polling fallback | WebSockets only if SSE proves insufficient |
| Auth | Phone number + SMS OTP; JWT access token + rotating refresh token | No passwords at MVP |
| USSD + SMS | Africa's Talking | Sandbox for dev |
| Payments | Safaricom Daraja (M-Pesa STK Push) | Sandbox for dev |
| Mobile app | **React Native + Expo** (EAS Build and EAS Submit) | One codebase for Android and iOS |
| Mobile state / data | TanStack Query + Zustand; `expo-sqlite` for offline store | Outbox queue for offline writes |
| Web app | Next.js (App Router) + Tailwind | Farmer and vet portal; PWA manifest and service worker |
| Role routing and access | Role claims in JWT + server-side guards; expo-router route groups (mobile), Next.js middleware (web) | One codebase, three role experiences; the server is the authority |
| Maps | Google Maps SDK (or Mapbox); verify Kenya coverage and pricing | Deep-link to native navigation for directions |
| Push | FCM (Android) + APNs (iOS) via Expo Notifications | SMS fallback if push is not delivered |
| File storage | S3-compatible bucket, presigned uploads | Compress images on device before upload |
| Testing | Vitest + Supertest (API), Jest + React Native Testing Library (app), Playwright (web), Maestro (app E2E) | |
| Containers | **Docker + Docker Compose** for the whole backend (API, worker, Postgres, Redis, MinIO) | See section 6.1. Expo and Next.js dev servers run on the host, not in Docker |
| CI/CD | GitHub Actions builds and pushes Docker images; EAS for app builds | |
| Observability | Pino logs + Sentry (API, web, mobile) | Redact phone numbers in logs |

If you want to swap anything, propose it and explain the tradeoff first.

**Decision: one app for all roles (farmer, vet, admin).** Simpler store presence, shared code and design system, one login, and multi-role users are handled naturally. Costs to manage: admin code must stay isolated and lazy-loaded so it does not bloat the app for farmers on low-end phones, and admin features in a public binary need strict server-side authorization and 2FA (sections 8.0 and 17). Revisit only if bundle size, store review, or security concerns force a split.

## 6. Repository Structure

```
vetlink/
├── CLAUDE.md
├── docker-compose.yml            # local dev: api, worker, db, redis, minio (+ tools profile)
├── docker-compose.prod.yml       # production: api, worker, reverse proxy (DB is managed, not here)
├── .dockerignore
├── .env.example
├── apps/
│   ├── api/                      # Fastify backend (runs in Docker)
│   │   ├── Dockerfile                # multi-stage: dev, build, prod
│   │   └── src/
│   │       ├── modules/
│   │       │   ├── auth/             # OTP, tokens, sessions, devices, roles, admin 2FA
│   │       │   ├── users/
│   │       │   ├── ussd/             # menu engine, session handling
│   │       │   ├── sms/              # inbound parser, outbound sender
│   │       │   ├── bookings/         # state machine, service
│   │       │   ├── matching/         # vet scoring + wave dispatch
│   │       │   ├── payments/         # STK push, callbacks, reconciliation
│   │       │   ├── vets/             # onboarding, verification, availability
│   │       │   ├── animals/          # herd records, photos
│   │       │   ├── treatments/
│   │       │   ├── reminders/
│   │       │   ├── notifications/    # router: push → SMS fallback
│   │       │   ├── ratings/
│   │       │   ├── uploads/          # presigned URLs
│   │       │   ├── outbreaks/        # aggregation queries
│   │       │   └── admin/
│   │       ├── db/                   # schema, migrations, seeds
│   │       ├── jobs/                 # BullMQ workers
│   │       └── lib/                  # phone utils, geo, errors, logger
│   ├── mobile/                   # Expo app (farmer + vet + admin roles)
│   │   ├── app/                      # expo-router screens
│   │   │   ├── (auth)/               # login, OTP, onboarding, role picker
│   │   │   ├── (farmer)/
│   │   │   ├── (vet)/
│   │   │   └── (admin)/              # essentials only, lazy-loaded
│   │   ├── src/{components,hooks,offline,notifications,theme}/
│   │   └── eas.json
│   └── web/                      # Next.js: one app, route groups per role
│       └── app/
│           ├── (auth)/
│           ├── farmer/
│           ├── vet/
│           └── admin/            # full admin console, noindex, not linked publicly
├── packages/
│   ├── shared/                   # zod schemas, enums, roles/permissions, booking state machine types
│   ├── api-client/               # typed client generated from OpenAPI
│   ├── i18n/                     # en.json, sw.json (namespaces: ussd, sms, app)
│   └── ui-tokens/                # colors, spacing, typography shared by mobile and web
└── docs/
    ├── spec/                     # product and technical spec, read on demand (see 0.1)
    ├── kickoff-prompts.md
    ├── ussd-flows.md             # generated during the build
    ├── sms-commands.md
    ├── api.md
    ├── store-release-checklist.md
    └── runbook.md
```

Use a pnpm workspace with Turborepo. Mobile and web must consume `packages/shared`, `packages/api-client`, and `packages/i18n` so types and strings stay in sync.

Docker setup, compose file, Dockerfile, env vars, and the local access map: `docs/spec/02-docker-and-environments.md` (section 6.1).

## 15. Coding Conventions

- TypeScript `strict`. No `any` without a comment explaining why.
- Validate all external input (webhooks, SMS text, API bodies) with zod at the boundary.
- Business logic lives in backend services. Adapters (USSD, SMS, REST, webhooks) translate and delegate, never decide.
- **Authorization is enforced on the server for every request.** Client route guards and hidden screens are UX, not security. Never trust a role claim from the client for sensitive actions; re-check against the database.
- Share types and zod schemas via `packages/shared`. Never duplicate an enum or status string in a client.
- Errors: typed domain errors mapped to channel-appropriate replies (USSD `END`, SMS, HTTP code + `message_key`).
- Money: integers in KES (no floats). Time: store UTC, display in Africa/Nairobi (EAT).
- Logging: structured (pino / Sentry breadcrumbs). **Never log full phone numbers, OTPs, tokens, or payment secrets.** Mask as `2547****123`.
- Feature flags for risky or store-gated features (server-controlled config).
- Commits: conventional commits. Small PRs, one concern at a time.
- Migrations are forward-only and reviewed. Never edit an applied migration.
- Mobile/web UI: reuse tokens from `packages/ui-tokens`, no magic numbers, all text via i18n keys.

## 23. Definition of Done

A feature is done when:
- It works in **both languages** and on **every channel it is meant for** (per the parity matrix), and is correctly gated by role and permission.
- Tests pass, including retry/duplicate/timeout/offline cases.
- It performs acceptably on a low-end Android device.
- Logs contain no PII or secrets.
- API changes are reflected in the OpenAPI spec and generated client, and backward compatibility with released app versions is preserved.
- Documentation in `docs/` is updated, and any changed decision is reflected in this file.
