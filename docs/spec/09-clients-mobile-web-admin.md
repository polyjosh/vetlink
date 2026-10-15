# Clients: Mobile App, Web App, Admin Console

> Part of the VetLink spec. Process rules, commands, guardrails, and the progress tracker are in `/CLAUDE.md`. Section numbers (for example 8.5 or 13) are stable across all spec files; find the file for a section with the map in `/CLAUDE.md` section 0.1 or `docs/spec/README.md`.

## 11. Mobile App Requirements

**Targets and performance (low-end devices are the norm):**
- Android is the priority. Target a minimum of Android 8+ (verify against the current Expo SDK support matrix). iOS 15+ or the Expo SDK minimum.
- Test on a real low-end device (2 GB RAM class), not just emulators.
- Budgets: install size ideally under 30 MB, cold start under 3 s on a low-end device, list scrolling at 60 fps for typical data.
- Ship Android App Bundles (AAB). Use Hermes. Lazy-load heavy screens (maps, camera). Keep the `(admin)` route group and its dependencies out of the startup path, so farmers and vets never pay for admin code.

**Offline-first (vet side especially):**
- Local SQLite cache for the active job, job history, animals, and drafts.
- **Outbox pattern:** writes (status changes, treatment logs, photos) queue locally, then sync with idempotency keys when connectivity returns. Show a visible "pending sync" badge.
- Conflict rule: server state machine wins for booking status; treatments are append-only, so no conflicts.
- Photos upload in the background with retry, and resize/compress first.

**UX for low literacy and low bandwidth:**
- Icons plus text labels, large touch targets (≥ 48dp), high contrast, readable in sunlight.
- Swahili and English switchable in-app. Avoid idioms that translate poorly.
- Data-saver mode: skip image previews, defer map tiles when on weak connections.
- Every screen has graceful loading, empty, error, and offline states.

**Permissions (ask in context, explain why, work without when possible):**
- Location (foreground; background only for vets who opt in to live location), camera/photos, notifications.
- If location is denied, fall back to ward picker.

**Push notifications:**
- Android high-priority channel for job offers and emergencies, with sound and full-screen intent where allowed. Handle Android battery-optimization killers by prompting vets to allow background activity, and lean on SMS fallback.
- Notification permission prompts on iOS and Android 13+ must be timed sensibly (after context, not at first launch).

**Deep links:** `vetlink://booking/:id` and universal/app links for SMS links, so an SMS about a booking can open the app when installed, or the web app otherwise.

**Token refresh:** refresh one request at a time (single-flight). Concurrent calls wait for the in-flight refresh and reuse its result; on web, coordinate across tabs (Web Locks or BroadcastChannel). The server accepts a just-rotated token for 60 s (lost responses), but a client that keeps using a superseded token after that has its whole session revoked as suspected theft.

**Security on device:** tokens in secure storage (Keychain / Keystore via `expo-secure-store`), certificate pinning considered later, no sensitive data in logs, screenshots allowed but no PII in notification previews on lock screen for payment info.

## 12. Web App Requirements

- Responsive, mobile-first. Works on low-end Android browsers.
- **PWA:** manifest, installable, offline shell, and caching of static assets. Web push where supported.
- Farmer web: request vet, track booking, animals, history. Vet web: online toggle, offers, active job, completion form, earnings. Admin web: the full admin console (section 13).
- Auth and API usage identical to mobile (generated client, OTP login).
- Accessibility: keyboard navigable, semantic HTML, sufficient contrast.
- SEO only for public marketing pages (landing, how it works, become a vet). The app itself is behind login.
- **Admin lives in the same web app** under `/admin`: `noindex`, not linked from any public page, protected by Next.js middleware plus server-side checks on every data call. Admin sessions are shorter-lived, require 2FA, and every action is audit-logged. An optional IP allowlist for high-risk admin permissions (e.g. finance) can be added at the edge.

## 13. Admin Console (inside the same app)

Admins use the same app as everyone else and are routed to the admin console after 2FA. The **full console is on web** (tables, maps, exports). The **mobile app exposes essentials only**, for acting on the go:

- **Mobile (essentials):** vet verification queue (review documents, approve/reject), live bookings board with reassign/cancel, alerts (no-vet-found, stuck payments), quick user lookup.
- **Web only:** analytics and maps, payments and reconciliation, refunds and payouts, config editing, outbreak dashboard, role management, exports.

Available sections and actions depend on the admin's permission (`verifier`, `support`, `finance`, `analyst`, `super_admin`).

- **Vet verification queue:** review applications with the checklist, request changes, approve, reject, or suspend, exactly as specified in section 8.3 (audit-logged, four-eyes for assisted onboarding).
- **Bookings:** live board, filter by status/county/channel, manual reassign, refund, cancel.
- **Supply and demand:** map of bookings vs. available vets, no-vet-found hotspots by ward, offer acceptance rates.
- **Payments:** reconciliation view, stuck/failed payments, refunds, payouts.
- **Outbreaks:** disease counts by ward and week, alert thresholds.
- **Config:** matching weights, radii, fee bands, timeouts, notifiable disease list (all versioned and audit-logged).
- **Users:** search by phone, view history, handle account deletion requests.
- **Content:** diagnosis list, i18n string overrides if needed.
