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
| `docs/spec/15-change-set-1.md` | §24 Change Set 1: profiles, farmer chooses vet, scheduling, badges, alerts, referrals, UI upgrades (amends §8 to §17) | Any CS1 to CS10 task; anything touching profiles, booking modes, vet list, or the new statuses |

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
| Start backend (api, worker, db, redis, s3) | `docker compose up -d` |
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
| Web end-to-end (Playwright) | `pnpm test:e2e` |
| Regenerate OpenAPI + typed client | `pnpm api:generate` |
| Web dev server | `pnpm --filter web dev` |
| Mobile dev server (Expo) | `pnpm --filter mobile start` |
| Local USSD simulator | `pnpm ussd:sim` |
| Local SMS simulator (one inbound SMS) | `pnpm --filter api sms:sim -- --phone 07… "Y4"` |
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
- [x] **M1: Scaffold and Docker.** *(2026-10-15, `chore/scaffold-docker`)* pnpm + Turborepo monorepo, `apps/api` skeleton with `/health` and `/ready`, `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `.env.example`, root scripts from 0.4, CI that builds the image, README with the local access map. *Done when:* `docker compose up -d` starts everything healthy, `curl localhost:4000/health` returns OK, `pnpm check` is green. **Read:** `02-docker-and-environments.md`.
- [x] **M2: Database.** *(2026-10-15, `feat/db-schema-seed`)* Drizzle schema for the data model, first migration, `db:seed` with demo users and one county's wards. *Done when:* `docker compose run --rm migrate` creates all tables from a clean volume and the seed runs twice without errors. **Read:** `07-data-model.md`, `12-security-privacy.md`.
- [x] **M3: Auth and roles.** *(2026-10-15, `feat/auth-otp-roles`)* OTP request/verify (`SMS_MODE=log`), JWT + refresh rotation, devices, role claims and guards, admin TOTP 2FA and step-up. *Done when:* the auth and authorization tests pass. **Read:** `03-auth-and-roles.md`, `08-api.md`, `12-security-privacy.md`, `11-testing.md`.
- [x] **M4: Booking service.** *(2026-10-15, `feat/bookings-service`)* Channel-agnostic service and the single transition function; `bookings` and `booking_offers` flows. *Done when:* state machine tests pass, including invalid transitions. **Read:** `07-data-model.md`, `06-matching-payments-notifications.md`, `08-api.md`.
- [x] **M5: OpenAPI and typed client.** *(2026-10-15, `feat/openapi-client`)* Schemas to OpenAPI, `/docs`, generated `packages/api-client`. *Done when:* `pnpm api:generate` is clean and the client compiles. **Read:** `08-api.md`.
- [x] **M6: USSD.** *(2026-10-15, `feat/ussd`)* Engine, language and main menu, booking flow, `pnpm ussd:sim`. *Done when:* table-driven tests pass in sw and en and a booking can be made through the simulator. **Read:** `04-farmer-flows.md`, `01-product-and-channels.md`.
- [x] **M7: Payments.** *(2026-10-15, `feat/payments`)* STK push abstraction with `PAYMENTS_MODE=mock|sandbox`, idempotent callbacks, reconciliation job. *Done when:* duplicate, late, failed, and stuck payment tests pass. **Read:** `06-matching-payments-notifications.md` (8.6), `10-integrations.md`.
- [x] **M8: Matching and notifications.** *(2026-10-15, `feat/matching-notifications`)* Eligibility (approved vets only), scoring, waves, BullMQ timeouts, notification router (push then SMS). *Done when:* matching, race, and fallback tests pass. **Read:** `06-matching-payments-notifications.md`, `05-vet-flows-and-onboarding.md` (gating), `10-integrations.md`.
- [x] **M9: SMS vet commands.** *(2026-10-15, `feat/sms-commands`)* Parser and flows (Y/N/OTW/ARR/DONE/ON/OFF/HELP). *Done when:* parser tests pass and **the end-to-end dev demo works: book through the USSD simulator, a vet accepts by SMS command, completes the job, the farmer rates it.** First demoable milestone. **Read:** `05-vet-flows-and-onboarding.md` (8.4), `06-matching-payments-notifications.md`.
- [x] **M10: Vet application and admin verification.** *(2026-10-15, `feat/vet-verification`)* Application draft/submit/resubmit backend, verification gating everywhere, admin queue and decisions with audit log. *Done when:* the gating tests pass and an unapproved vet can never receive an offer. **Read:** `05-vet-flows-and-onboarding.md` (8.3), `07-data-model.md`, `09-clients-mobile-web-admin.md` (13), `12-security-privacy.md`.
- [x] **M11: Web app.** *(2026-10-16, `feat/web-app`)* Role router and guards, vet onboarding wizard and status screen, farmer flows, vet flows, admin console routes. *Done when:* the Playwright happy path (farmer books, vet accepts, job completes) passes. **Read:** `03-auth-and-roles.md`, `04-farmer-flows.md`, `05-vet-flows-and-onboarding.md`, `09-clients-mobile-web-admin.md`.
- [ ] **M12: Mobile app.** *(code complete 2026-10-16, `feat/mobile-app`; offline sync test passes; Maestro happy path written but not yet run: needs an Android emulator, not available on the dev machine)* Auth and role router, vet onboarding wizard (camera, background upload), farmer flows, vet job flow with offline outbox and push, admin essentials (lazy-loaded). *Done when:* the Maestro happy path passes on an Android emulator and the offline sync test passes. **Read:** `09-clients-mobile-web-admin.md` (11), `03-auth-and-roles.md`, `04-farmer-flows.md`, `05-vet-flows-and-onboarding.md`.
- [ ] **Change Set 1 (CS1 to CS10), owner-approved 2026-10-19.** Built after M12's code and before the Maestro run and M13, because it changes the mobile flows. Spec: §24 (`15-change-set-1.md`). Each item is one branch with its own plan; items touching schema, money, matching or the state machine wait for owner sign-off on the plan. Proposed dependencies are listed per item and approved in that session.
  - [x] **CS0: Spec update.** *(2026-10-19, `chore/spec-change-set-1`)* §24 written; pointers in §2, §8.1 to §8.9, §9, §10, §11 to §13, §16, §17, §21.
  - [x] **CS1: Profiles and photos.** *(2026-10-19, `feat/profiles-photos`; migration 0009; vet photo review is web-only for now, mobile admin later)* Username, avatars (vet photo re-review), animal photos, species SVG placeholders and empty-state illustrations, farmer and vet profile screens. **Read:** §24.1, §24.2, §24.13, `07-data-model.md`, `12-security-privacy.md`. *Proposed dep:* `react-native-svg`.
  - [x] **CS2: Vet practice and fees.** *(2026-10-19, `feat/vet-practice-fees`; migration 0010)* Premises, call-outs, fee per service with admin bands, working hours, vet profile page with qualifications and documents, wizard step 5 changes. **Read:** §24.3, §24.10, `05-vet-flows-and-onboarding.md`, `06-matching-payments-notifications.md`.
  - [x] **CS3: Ratings, follow-ups, badges.** *(2026-10-19, `feat/ratings-followups-badges`; migration 0011)* Rating tags, vet ratings screen, follow-up alerts, nightly badges, low-rating review flags. **Read:** §24.4, §24.7, §24.8.
  - [ ] **CS4: Farmer chooses the vet.** Booking modes, new statuses and transitions, nearby-vets and clinics lists, direct requests, STK on accept, rechoose and switch-to-auto, USSD choose screen and "My last vet", "Book again", photos before accepting. **Read:** §24.5, §24.6, §24.9, §24.15, §24.20, `04-farmer-flows.md`, `06-matching-payments-notifications.md`, `07-data-model.md`.
  - [ ] **CS5: Scheduled appointments.** Slots by part of day, working-hours filtering, reminders, 12-hour refund rule, admin alert. **Read:** §24.10, §8.6.
  - [ ] **CS6: Health card and public vet profile.** Animal health card with PDF export, public `/v/<slug>` page, share and QR code. **Read:** §24.14, §24.18. *Proposed deps:* `expo-print`, `expo-sharing`, a QR generator.
  - [ ] **CS7: Seasonal alerts and referrals.** Alert campaigns with cost guard and opt-out, referral codes and partner reports. **Read:** §24.11, §24.12, §8.9.
  - [ ] **CS8: Voice notes.** Record, upload, play after match. **Read:** §24.16. *Proposed dep:* `expo-audio`.
  - [ ] **CS9: Modern UI pass.** Bottom tabs, skeletons, dark mode, haptics. **Read:** §24.13, §11. *Proposed dep:* `expo-haptics`.
  - [x] **CS11: Commission and vet payouts.** *(2026-10-19: not needed for now. VetLink keeps the whole KES 200 deposit, so there are no payouts; the price split is shown in CS2. Revisit if a percentage commission returns.)*
  - [ ] **CS10: Live vet map.** Blocked by Open Question 21.10. **Read:** §24.17.
  - *Done when:* every item above is ticked (CS10 may stay blocked), `pnpm check` and `pnpm test:e2e` pass with the chosen-vet and emergency paths, and the Maestro flow is updated for M12.
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
- 2026-10-15: Node 24 LTS (`node:24.22.0-alpine`) instead of Node 20. Node 20 reached end of life in April 2026.
- 2026-10-15: TypeScript pinned to 6.0.x, not 7. typescript-eslint 8.71 supports TypeScript <6.1 only.
- 2026-10-15: Local object storage is SeaweedFS (`chrislusf/seaweedfs:4.48`, compose service `s3`, S3 API on 8333) instead of MinIO; supersedes MinIO in the earlier entry and in 6.1. The `minio/minio` image is no longer published on Docker Hub.
- 2026-10-15: Workspace packages export TS source under the `@vetlink/source` condition (dev, tests, typecheck) and `dist` otherwise (prod builds). No build step needed in dev; prod uses compiled JS.
- 2026-10-15: Dev containers run `tsx` directly with `init: true`, not `pnpm --filter api dev`. pnpm as PID 1 kills children with SIGKILL, so graceful shutdown never ran.
- 2026-10-15: drizzle-orm 0.45.4 + drizzle-kit 0.31.11. Enumerated columns are TEXT + CHECK built from the `as const` arrays in `packages/shared/src/domain.ts` (single source for DB, zod, clients). Migrations are applied by `src/db/migrate.ts` (drizzle-orm migrator), so production needs no drizzle-kit.
- 2026-10-15: drizzle-kit runs as `node --conditions=@vetlink/source node_modules/drizzle-kit/bin.cjs`. Its loader ignores tsconfig `customConditions`, and `--env-file` is not allowed in `NODE_OPTIONS`.
- 2026-10-15: Field encryption: AES-256-GCM for `national_id_enc` / `totp_secret_enc`, keyed HMAC-SHA256 for `national_id_hash`; both keys HKDF-derived from `DATA_ENCRYPTION_KEY`. A plain hash of an 8-digit ID is brute-forceable.
- 2026-10-15: Seeded-admin guard: the seed runs only with `APP_ENV` development/test AND a local DB host (`localhost`, `127.0.0.1`, `[::1]`, `db`), and is excluded from the production build. In production the API and worker refuse to start, and exit if found later (rechecked every 60s), when any dev seed account exists (by fixed ID or phone). Fail closed: a DB outage at production startup stops the process instead of serving with `/ready` 503. Seed phones `2547000000xx` may be real numbers (Kenya has no reserved fictitious range): never send them live SMS.
- 2026-10-15: `users.roles` holds only `farmer`/`vet`. Admin access comes only from an `admin_profiles` row with `revoked_at IS NULL` (`SESSION_ROLES` adds `admin` for session claims). Revoking that row revokes admin everywhere.
- 2026-10-15: `users.phone` may be NULL only after deletion; unique among active users (`deleted_at IS NULL`), so §17 anonymization works and a deleted number can sign up again.
- 2026-10-15: Invariant 2 also enforced in the DB: CHECK `NOT is_available OR verification_status = 'approved'`. Suspending a vet must set `is_available = false` in the same statement.
- 2026-10-15: Encrypted fields bind `table.column:rowId` as GCM associated data (`fieldContext`), so a value moved to another row or column fails to decrypt.
- 2026-10-15: Dev seed county is Kiambu (60 wards; approximate sub-county coordinates). Seed data only; the pilot county is still Open Question 21.1.
- 2026-10-15: Schema additions beyond §9 (owner-approved): CHECKs on `users.phone`/`language`/`roles`; FKs `media.booking_id`, `refresh_tokens.device_id`; uniques `refresh_tokens.token_hash`, `vet_applications(vet_user_id, version)`, `booking_offers(booking_id, vet_id)` (replaces the plain `booking_offers(booking_id)` index); FK/lookup indexes including `vets.national_id_hash`. Migration 0001 adds CHECKs: money non-negative (`fee_quoted`, `base_call_out_fee`) and `payments.amount > 0` (direction comes from `type`), `media.kind`/`vet_documents.kind` enums, `vets.rating` 1 to 5. Payment uniqueness rules are deferred to M7.
- 2026-10-15: `.claude/settings.json` no longer denies `git push`; a push now prompts for approval each time. Force pushes (`--force`, `--force-with-lease`, `-f`) stay denied. The owner wants Claude able to push (and delete merged remote branches) when asked; 0.3 still requires asking first.
- 2026-10-15: DB integration tests use `TEST_DATABASE_URL` and create/drop a throwaway database per run; CI provides a Postgres service, and the tests fail (not skip) in CI without it. Constraint tests assert the exact constraint name.
- 2026-10-15: Sessions: `auth_sessions` (migration 0002) holds one login per device, plus admin 2FA (`mfa_verified_at`, valid 8 h) and step-up (`step_up_at`, valid 5 min) state. `refresh_tokens` gained `session_id`, `replaced_by_id` and `created_at`, and lost `device_id` (superseding that FK in the schema-additions entry above). Access tokens are HS256 JWTs (15 min, `jose` 6.2.12) carrying `sub`, `sid` and `roles`; every authenticated request reloads the session, user and admin profile from the DB, so logout, deletion and admin revocation take effect immediately. Refresh tokens are opaque 256-bit values stored as SHA-256 and rotated on every use, with one live token per session. A rotated token presented within 60 s is accepted (a lost response on a flaky network); after that it counts as reuse and revokes the session. `JWT_REFRESH_SECRET` is removed; `JWT_SECRET` must be at least 32 characters.
- 2026-10-15: Every route declares `config.access` (`public`, `user`, `role`, or `admin` with a permission and optional `stepUp`). An `onRoute` hook refuses to start the app if a declaration is missing or an `/v1/admin/*` route lacks admin access. Admin permissions are the admin roles, and `super_admin` holds all of them. Non-admins and admins without the permission get `not_found`. Role routes return `forbidden` and never trust the token's role claim.
- 2026-10-15: OTP: a 6-digit code stored as a keyed HMAC of `phone:code` (HKDF purpose `otp`), valid 5 min, burned after 5 wrong attempts, and superseded by a new request. Limits are keyed on phone+IP first, so another person cannot lock a number's owner out: 3 SMS per phone+IP per 10 min, 10 per phone per hour, 30 per IP per hour (generous because of carrier NAT). Wrong codes lock the phone+IP pair after 10 in an hour, and the phone from every IP after 30 in 24 h (bounding distributed guessing to about 30 a day). Both locks last 1 h. Attempts with no live code are not counted (nothing to guess). Counters live in Redis (an atomic INCR+PEXPIRE Lua script). The response never reveals whether a number has an account; `otp_expired` (which shows only that a code was recently requested) is a deliberate UX tradeoff. `OTP_FIXED_CODE` is a dev shortcut rejected in production. With `SMS_MODE=log`, codes are logged only in development and test. `SMS_MODE=sandbox|live` fails startup until the Africa's Talking sender lands (M9).
- 2026-10-15: Admin TOTP is in-house RFC 6238 (SHA-1, 6 digits, 30 s, ±1 step), tested against the RFC vectors, instead of `otplib` (6 sub-packages). Replay of a used step is blocked in Redis, 5 failures in 15 min lock 2FA for 15 min, and every failure is audited and logged. Enrolment is `/v1/auth/2fa/setup` then `/enable`, which returns 10 single-use recovery codes stored as keyed HMACs. All 2FA events go to `audit_log`. Enrolment is open only until `admin_profiles.totp_enrol_expires_at` (migration 0003; 72 h from the admin grant in M10 or from a reset; cleared on enrolment), so an OTP alone cannot enrol an authenticator later. `POST /v1/admin/users/:userId/2fa/reset` (super_admin plus step-up, never on yourself) clears TOTP and recovery codes, drops 2FA on the target's sessions, and reopens the window. A sole super admin who loses both the authenticator and the recovery codes needs manual DB recovery.
- 2026-10-15: Error logs go through `serializeError`, which drops query parameters (Drizzle `params`, postgres.js `parameters`, Drizzle's `params:` message line), masks phone numbers in every string (including Postgres `detail`), and keeps a scrubbed cause chain. Drizzle errors otherwise log phone numbers and token hashes.
- 2026-10-15: Ending a session (logout, or revocation for refresh-token reuse) clears its device's push token, and a push token lives on only one device row. M8 must send push only to devices whose session is live; sessions that lapse without logout keep their token until then.
- 2026-10-15: `TRUST_PROXY` lists proxy IPs/CIDRs (or `loopback`/`linklocal`/`uniquelocal`) whose `X-Forwarded-For` is trusted; empty means trust none. Hop counts are rejected: they cannot verify the immediate peer, so a direct client could forge the header and dodge per-IP limits (Fastify itself fails closed on them). Production (M13) must set it to the reverse proxy's address.
- 2026-10-15: Clients refresh tokens single-flight (one refresh at a time; across tabs on web). Concurrent refreshes with one token both succeed, but a client that keeps a superseded token past the 60 s grace window gets its session revoked.
- 2026-10-15: Lock order for session writes: the `auth_sessions` row first, then its `refresh_tokens`. Refresh used to lock the token row first, which deadlocked (a 500) when two tokens of one session refreshed at once; a regression test covers it.
- 2026-10-15: Migration 0002 adds `refresh_tokens.session_id` NOT NULL without a default. That was safe because no environment had refresh-token rows; applied migrations stay unchanged (forward-only).
- 2026-10-15: Owner gave standing approval to build M4 to M12 without stopping at gated milestones. Each milestone gets its own branch, a passing `pnpm check`, a tracker and decision-log update, and a local merge to `main`. Dependencies are pinned and listed in each report. Claude stops only for decisions it cannot safely default, and never pushes.
- 2026-10-15: Open Question 21.2 decided: deposit only. VetLink takes the KES 200 STK deposit (refund or forfeit per §8.6) and the farmer pays the balance to the vet directly. Commission and platform-held balances come in Phase 3.
- 2026-10-15: Open Question 21.13 deferred: the mobile app uses the placeholder ID `co.ke.vetlink.dev` until M13; nothing is published before then.
- 2026-10-15: Open Question 21.10 deferred: no map SDK yet. UIs use the ward plus an optional GPS pin, show ETA as text, and give directions by deep link to Google or Apple Maps.
- 2026-10-15: Bookings (migration 0004): `booking_events` records every status change with actor and channel. CHECKs pin `bookings.species` to `SPECIES` and `problem_type` to `PROBLEM_TYPES` (the vocabulary `vets.specialties` uses). `transition()` locks the booking row, enforces actor kind and ownership, and treats a repeat of the same event by the same actor as a no-op (offline and SMS retries). For `vet_accepted` it re-checks that the vet holds an offer and is approved (invariant 2), so no channel can bypass it. Offers stay acceptable while the booking is `pending`, even after their timeout.
- 2026-10-15: Booking API: `POST /v1/bookings` needs an `Idempotency-Key`, stored scoped per farmer; a different request under the same key gets 422. The fee is quoted by the server (placeholder flat KES 500 in `bookings/pricing.ts` until M8 quotes from nearby vets). Contact details (phones, farm notes) are visible to the other party only in `matched`/`en_route`/`in_service`; offers carry no farmer identity. Non-owners get `not_found`. Cancel reasons come from a fixed list (no free text). Admin booking cancel needs `support` plus step-up and is audited. Clients identify themselves with `X-VetLink-Channel: app|web`, used for analytics only.
- 2026-10-15: API schemas: routes declare zod schemas through `fastify-type-provider-zod` 7.0.0 (with `@fastify/swagger` 9.9.1, `@fastify/swagger-ui` 6.1.1, `openapi-types` 12.1.3), which validate requests and serialize responses, so undeclared fields are stripped and a response that breaks its schema is a 500 that is never sent. Named schemas (`named()`) become OpenAPI components; shared view types are checked equal to their schemas at compile time (`assertSameType`). Validation errors keep `{ code: invalid_request, details.fields }`. The access hook writes each route's rule into its OpenAPI description and adds bearer security to non-public routes. `/docs` exists only when `APP_ENV` is not production, as the one prefix exempt from per-route access declarations. `parseInput` remains for non-route input (USSD, SMS).
- 2026-10-15: `@vetlink/api-client` = generated `schema.ts` (`openapi-typescript` 7.13.0, a dev tool that runs fine on TS 6 despite its TS 5 peer range) + `openapi-fetch` 0.17.0 (about 6 KB, the only runtime dependency). `pnpm api:generate` exports the document without a database (a context that throws if touched). A test and a CI step fail when the committed client is stale. Generated files are excluded from lint and Prettier.
- 2026-10-15: M5 also added the profile endpoints the USSD and UI milestones need: `PATCH /v1/me`, `POST /v1/me/consent`, `POST /v1/me/roles` (farmer, or vet with `vetType`; consent first; admin never), `GET/PUT /v1/farmers/me`, public `/v1/locations/counties|wards`, `GET/POST /v1/animals`, `GET /v1/animals/:id/history`, and `GET /v1/meta/min-app-version` (`MIN_APP_VERSION`). Migration 0005 pins `animals.species`/`sex` to `SPECIES`/`ANIMAL_SEXES`.
- 2026-10-15: drizzle-kit asks interactively (TTY only) when a column is added and another dropped in the same table. Migration 0002 was generated in two passes and folded into one file before being applied anywhere.
- 2026-10-16: Web app on Next.js 16.3.8 + React 19.3.0 + Tailwind 4.3.3, built with webpack (`--webpack`). Turbopack cannot apply the `@vetlink/source` condition or map NodeNext `./x.js` imports to `.ts`. Route guard is `src/proxy.ts` (Next 16 renamed middleware); it and the client guard are UX only.
- 2026-10-16: Web session: Next.js route handlers `/api/session/{login,refresh,logout}` hold the refresh token in an httpOnly `SameSite=Strict` cookie (path `/api/session`) and require an `x-vetlink-csrf` header; the access token stays in memory. Refresh is single-flight per tab and across tabs (Web Locks). The browser reaches the API same-origin through Next rewrites to `API_URL`, which is fixed at build time. In production, set the API's `TRUST_PROXY` to the web server so per-IP limits see the caller.
- 2026-10-16: New `GET /v1/bookings/quote` (farmer): the same server fee quote a booking stores, shown before the farmer commits (§8.6). New package `@vetlink/ui-tokens` (colours, spacing, type, 48px touch target) for web and mobile.
- 2026-10-16: After login the account's saved language wins over the browser's last choice (seed farmer: sw, seed vet: en).
- 2026-10-16: Admin TOTP setup shows the secret and the `otpauth://` link, no QR image, to avoid a QR dependency. Revisit if admins struggle.
- 2026-10-16: `pnpm test:e2e` (apps/api/scripts/e2e-stack.ts): throwaway DB from `TEST_DATABASE_URL`, API and worker on 4100 with fixed OTP and mock payments, Redis index 14 flushed at start (booking-keyed BullMQ job IDs from a previous run would be dropped as duplicates), production web build on 3100, Playwright on a Pixel 5 viewport. CI runs it as its own job. eslint-plugin-react-hooks 7.1.1 lints `apps/web`.
- 2026-10-16: Mobile on Expo SDK 58.0.11 (React 19.3.0, React Native 0.88.0, expo-router 58.0.20, Hermes), versions pinned to the SDK's bundledNativeModules. Same route paths as web. TanStack Query 5.104.1 for server reads (last good answer cached in SQLite kv for offline screens) and zustand 5.0.15 for the outbox badge. pnpm's minimum-release-age check needed exclusions for SDK 58 packages republished this week (`pnpm-workspace.yaml`).
- 2026-10-16: Mobile offline writes use an outbox (SQLite) instead of server idempotency keys on status/complete: those transitions are naturally idempotent, so on a 409 the app re-reads the booking and treats "already there" as sent, anything else as a server-wins failure shown to the vet. Document uploads are compressed (1600 px JPEG, quality 0.7) and queued the same way; PDFs are web-only for now (no document picker dependency).
- 2026-10-16: Shared code moved out of web: `APPLICATION_FIELDS` (wizard fields) in `@vetlink/shared` and `errorMessage` in `@vetlink/i18n`, used by web and mobile. App-only strings live in `web.mobile` (sw + en).
- 2026-10-16: Metro resolves workspace packages with the `@vetlink/source` condition and maps their `./x.js` imports to `.ts` (`apps/mobile/metro.config.js`). CI bundles the Android app on every PR; Maestro runs on an emulator outside CI.
- 2026-10-19: Change Set 1 approved (spec §24). Non-emergency requests let the farmer choose a vet from a list; the deposit is taken by an STK push sent when the vet accepts, so a declined request needs no refund. Emergencies and "fastest available vet" keep pay-first waves. USSD offers "fastest" or the 3 nearest vets, plus "My last vet". Owner's request; recommendations accepted.
- 2026-10-19: Vets set a displayed "from" price per service within admin bands, plus the call-out fee. VetLink still charges only the KES 200 deposit (21.2 unchanged).
- 2026-10-19: Username is a display name only (login stays phone + OTP). Vets are always shown with their verified legal name; a vet's new photo needs a photo-only review because it is an identity check. Farmers' photos are live immediately.
- 2026-10-19: Vets see their ratings without farmer names. The vet list shows rounded distance from the base or premises, never coordinates or live location.
- 2026-10-19: Species placeholders and empty-state illustrations are simple flat SVGs drawn in-house, kept in `@vetlink/ui-tokens`.
- 2026-10-19: Clinic-visit bookings, referral rewards, and the live map are out of Change Set 1 (new Open Questions 21.19 to 21.21; 21.10 still blocks the map).
- 2026-10-19: Photos (CS1, migration 0009): `POST /v1/uploads/presign` takes `purpose: photo` (`avatar`, `animal_photo`; JPEG/PNG up to 500 KB, re-encoded on the device so EXIF is dropped) alongside `purpose: vet_document`; uploads are confirmed with `PUT /v1/me/avatar` or `PUT /v1/animals/:id/photo`, which re-check owner, type and size in storage. A replaced or removed photo's row and object are deleted. Photo links are signed for 1 h and clients fall back to the placeholder when one fails.
- 2026-10-19: Vet photos: a new one waits in `vets.pending_avatar_media_id` for a verifier (`/v1/admin/vet-photos`, audit-logged, vet notified). A rejected photo's object is deleted but its row is kept so the vet sees the reason. Vets cannot remove the live photo, only withdraw a pending one. On a vet's first approval the `profile_photo` document is copied in storage to become the avatar (documents follow their own retention).
- 2026-10-19: Booking views show the other party's photo and username (`vet.displayName`/`photoUrl`, `farmer.displayName`/`photoUrl`); a vet is always shown with the verified name. Mobile uploads profile and animal photos directly (online), not through the outbox: they are not time-critical. `users.theme` is stored now; the picker comes with dark mode (CS9). Account deletion (M13) must also delete media rows and objects.
- 2026-10-19: Revenue model changes: VETS pay a subscription to use VetLink; FARMERS never pay VetLink a subscription (owner decision, supersedes the revenue part of 21.2). Farmers still pay vets directly for consultation, services and call-out. Open: price, period, trial, what a lapse does, whether the KES 200 deposit stays, and whether Google Play / Apple require their billing for a subscription bought in the app (to be checked before building; spec §24.24).
- 2026-10-19: Subscription model dropped the same day (owner). VetLink earns a COMMISSION: the farmer pays the deposit to VetLink by STK push, VetLink keeps a percentage and pays the rest out to the vet by M-Pesa. No subscriptions for anyone. Supersedes the entry above and the "farmer pays the balance to the vet directly, commission later" part of the 21.2 entry. Open: rate, deposit amount, when the payout happens, commission on forfeits and refunds (spec §24.24).
- 2026-10-19: Simplified for now (owner): VetLink keeps the whole KES 200 deposit as its fee, and the deposit counts towards the vet's bill: the farmer pays the vet the total minus KES 200 on the farm. No payouts, no B2C. Clients show both parts ("KES 200 now to VetLink, from KES X to the vet"). The consultation fee's lower band is at least KES 200 so the vet's share is never negative. A deposit forfeited after the vet set off stays with VetLink (no payout path); the no-vet-found refund is unchanged. Supersedes the commission entry above.
- 2026-10-19: Prices (CS2, owner): consultation is the base service of every request and every vet must set its fee (no going online without it); vets set a "from" price per offered service; farmers add services to the consultation; the call-out fee stays separate. Total = consultation + services + call-out, shown as a starting price, booking fee included. Before acceptance the farmer sees the range over eligible vets; the accepting vet's breakdown is fixed on the booking at acceptance (`bookings.vet_price`, written in `transitions.ts`). Admin bands per priced item (`fees.serviceBands`) and the booking fee (`payments.bookingFeeKes`) are config; each booking stores its own booking fee. The API field `depositKes` keeps its name for older apps but means the booking fee. USSD derives services from the problem.
- 2026-10-19: Vet practice edits moved to `PATCH /v1/vets/me/profile` in the vets module (now returns the profile, 200 instead of 204) and must leave the practice complete; `GET /v1/vets/me` carries prices, practice, qualifications (national ID as last 3 digits) and the vet's own documents, which open through a logged link. The wizard's `availabilityHours` text gave way to structured `workingHours`; fields can declare `showIf` and `defaultValue`.
- 2026-10-19: CS3 (migration 0011): ratings take tags from a fixed list (positive for 4-5 stars, problems for 1-2, both for 3; app and web only). A rating of 2 stars or less tagged `rude`, or 3 ratings of 2 stars or less within 30 days, sets `vets.review_flag_*` once; the vet stays online; verifiers list (`/v1/admin/vets/flagged`) and clear it (audited). Vets read their ratings without farmer names and their follow-ups (farmer contact only within 7 days; the server sends `daysAway`).
- 2026-10-19: Daily jobs: 07:00 EAT sends farmer reminders due today (§8.8 had never been built) and vets' follow-ups today; 18:00 EAT sends vets' follow-ups tomorrow; 02:00 EAT recomputes badges (also on approval, suspension, reinstatement). Sends are claimed by a timestamp first (`reminders.sent_at`, `treatments.vet_alert_*_sent_at`), so reruns never send twice; vet alerts live on treatments (the vet comes from the booking), not on reminders as first planned. Reminder notifications are critical (SMS fallback, §8.7). Badge thresholds are config (`badges.thresholds`); only approved vets hold badges, and a suspended vet shows none. CHECK literals may now contain digits (`jobs_50`).

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
| Containers | **Docker + Docker Compose** for the whole backend (API, worker, Postgres, Redis, SeaweedFS for S3-compatible storage) | See section 6.1. Expo and Next.js dev servers run on the host, not in Docker |
| CI/CD | GitHub Actions builds and pushes Docker images; EAS for app builds | |
| Observability | Pino logs + Sentry (API, web, mobile) | Redact phone numbers in logs |

If you want to swap anything, propose it and explain the tradeoff first.

**Decision: one app for all roles (farmer, vet, admin).** Simpler store presence, shared code and design system, one login, and multi-role users are handled naturally. Costs to manage: admin code must stay isolated and lazy-loaded so it does not bloat the app for farmers on low-end phones, and admin features in a public binary need strict server-side authorization and 2FA (sections 8.0 and 17). Revisit only if bundle size, store review, or security concerns force a split.

## 6. Repository Structure

```
vetlink/
├── CLAUDE.md
├── docker-compose.yml            # local dev: api, worker, db, redis, s3 (SeaweedFS) (+ tools profile)
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
