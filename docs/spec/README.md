# VetLink Spec Index

The detailed product and technical spec, split by topic so Claude Code can read only what a task needs. Start from `/CLAUDE.md` (process, commands, guardrails, tracker, core rules). Section numbers are stable across files.

| File | Contains | Read when |
|---|---|---|
| `00-claude-code-setup.md` | Claude Code config: `settings.json`, slash commands | Milestone 0, or when changing Claude Code config |
| `01-product-and-channels.md` | §2 channels and parity matrix, §3 users, §7 glossary | Any feature spanning USSD, SMS, app, and web; unsure who uses what |
| `02-docker-and-environments.md` | §6.1 Docker, compose, Dockerfile, env vars, dev shortcuts, local access map, production summary | Docker, env vars, CI/CD, deploy, local setup |
| `03-auth-and-roles.md` | §8.0 login, role routing, admin permissions | Auth, roles, route guards, admin access |
| `04-farmer-flows.md` | §8.1 USSD flow, §8.2 farmer app and web flow | USSD, farmer screens, booking creation |
| `05-vet-flows-and-onboarding.md` | §8.3 vet app flow plus onboarding and verification, §8.4 SMS commands | Anything vet-related, verification gating, SMS parser |
| `06-matching-payments-notifications.md` | §8.5 matching, §8.6 payments, §8.7 notifications, §8.8 reminders, §8.9 outbreaks | Dispatch, M-Pesa, push/SMS routing, reminders |
| `07-data-model.md` | §9 schema and booking state machine | Any database, schema, or migration work |
| `08-api.md` | §10 API design, endpoints, idempotency | New or changed endpoints, OpenAPI |
| `09-clients-mobile-web-admin.md` | §11 mobile app, §12 web app, §13 admin console | Expo app, Next.js app, admin UI |
| `10-integrations.md` | §14 Africa's Talking, Daraja, push, maps, storage | Third-party integration work |
| `11-testing.md` | §16 testing requirements | Writing tests, judging whether work is done |
| `12-security-privacy.md` | §17 security, privacy, compliance | Auth, PII, vet documents, data protection, anything sensitive |
| `13-store-release.md` | §18 App Store and Play Store release | Store submission and release |
| `14-roadmap-metrics-open-questions.md` | §19 roadmap, §20 metrics, **§21 open questions** | Planning, or before any decision touching money, verification policy, hosting, or store IDs |
| `15-change-set-1.md` | §24 Change Set 1: profiles, farmer chooses vet, scheduling, badges, alerts, referrals, UI upgrades (amends §8 to §17) | Any CS1 to CS10 task; anything touching profiles, booking modes, vet list, or the new statuses |
