# Roadmap, Metrics, Open Questions

> Part of the VetLink spec. Process rules, commands, guardrails, and the progress tracker are in `/CLAUDE.md`. Section numbers (for example 8.5 or 13) are stable across all spec files; find the file for a section with the map in `/CLAUDE.md` section 0.1 or `docs/spec/README.md`.

## 19. Roadmap

**Phase 0: Manual pilot (weeks 0 to 4, minimal code)**
WhatsApp group + spreadsheet + manual M-Pesa with one dairy co-op in one county. Prove that farmers book and vets show up. Capture real volumes, fees, response times, and which phones vets use (this decides app priority).

**Phase 1: Core platform + USSD/SMS + Web (weeks 4 to 12)**
API, auth (OTP), bookings, matching waves, STK deposit, USSD farmer flow, SMS vet commands, **web app** (farmer, vet, and admin roles, PWA; includes the vet onboarding wizard, the admin verification console, and bookings). Web ships first because it needs no store review and lets us iterate quickly.

**Phase 2: Mobile apps (weeks 10 to 20, overlapping)**
Expo app for all three roles (admin limited to essentials), with the role router from 8.0. Push, maps, photos, offline vet flow. Order: Android internal test → closed beta → Play Store → iOS TestFlight → App Store.

**Phase 3: Retention and depth**
Animal records depth, reminders in-app, ratings, balance payments, earnings and payouts, co-op reporting, outbreak dashboard.

**Phase 4: Scale**
WhatsApp channel, county integrations, B2B (co-ops, processors, agrovets), multi-county expansion, performance and cost optimization.

(If store presence is a hard early requirement, run Phase 2 in parallel with Phase 1 using the same API. Keep the API contract stable, since both channels depend on it.)

## 20. Success Metrics

- **Time-to-match** (median, p90), split by channel
- **Offer acceptance rate** and **no-vet-found rate** by ward
- **Booking completion rate** (booked → done)
- **Channel mix:** share of bookings via USSD / app / web, and USSD → app migration
- **App health:** crash-free sessions, ANR rate, cold start time, push delivery rate, offline sync success rate
- **Repeat farmers** within 30/60 days
- **Vet utilization**, online hours, earnings per vet
- **Payment success rate** and reconciliation mismatches (target: 0)
- **Store metrics:** installs, ratings, uninstall rate

## 21. Open Questions (ask the owner before assuming)

1. Pilot county and partner co-op?
2. **Revenue model decided 2026-10-19: VetLink keeps a commission on the farmer's deposit and pays the rest to the vet; no subscriptions (§24.24).** Original question: Balance payment: through the platform (we hold funds) or direct farmer-to-vet M-Pesa with commission collected separately?
3. Commission model at launch: 10 to 15% of call-out fee only, or also treatment fees?
4. Shortcode: shared USSD code vs dedicated (cost and timeline)?
5. Which diseases count as "notifiable" for outbreak alerts?
6. Who verifies KVB registrations, and how often?
7. Pricing bands for call-out fees by distance.
8. ~~One app or separate apps?~~ **Decided: one app for farmer, vet, and admin with role-based routing.** Revisit only if bundle size, store review, or security forces a split.
9. Legal entity and developer accounts for Apple/Google: who owns them?
10. Map provider preference and budget (Google Maps vs Mapbox)? Also blocks the live vet map (§24.17).
11. Do we want in-app chat or masked calling between farmer and vet (later phase), or is direct phone call enough?
12. Vet payouts: schedule, method (M-Pesa B2C), and minimum threshold?
13. Brand name, domain, and app ID, since these are hard to change after store publication.
14. Who are the first admins, and which permissions does each get? Which authenticator approach for 2FA (TOTP app assumed)?
15. Which admin actions are allowed on mobile beyond the essentials listed in section 13?
16. Vet verification policy: target review time (48h assumed), exact documents required for vets vs paravets, how KVB registration is checked (manual register lookup assumed), reapplication cooldown after rejection, and how licence renewals are handled.
17. Who are the initial verifiers, and is second-reviewer approval required for every vet or only for assisted onboarding?
18. Production hosting: a single VPS with Docker Compose or a managed container platform, which cloud, and which region (consider Data Protection Act rules on cross-border data)?
19. Referral rewards: should referrers (farmers, co-ops, agrovets) earn anything, and what (airtime, deposit waiver, cash)? Attribution is tracked from Change Set 1 (§24.12).
20. Which admin permission should create and send farmer alert campaigns? `super_admin` only until decided (§24.11).
21. Clinic-visit bookings (farmer brings the animal to the vet's premises): deposit or not, and fee rules (§24.3).
