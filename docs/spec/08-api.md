# API Design

> Part of the VetLink spec. Process rules, commands, guardrails, and the progress tracker are in `/CLAUDE.md`. Section numbers (for example 8.5 or 13) are stable across all spec files; find the file for a section with the map in `/CLAUDE.md` section 0.1 or `docs/spec/README.md`.

## 10. API Design

- REST, JSON, versioned under `/v1`. OpenAPI generated from zod schemas; `packages/api-client` is generated from it. Mobile and web use only the generated client.
- Auth: `POST /v1/auth/otp/request`, `POST /v1/auth/otp/verify`, `POST /v1/auth/refresh`, `POST /v1/auth/logout`. Rate-limit OTP by phone and IP, and lock after repeated failures.
- Roles and access: every route declares required role(s) and, for admin routes, a required permission. Ownership checks (farmer owns booking, vet is assigned) live in the service layer. Admin routes live under `/v1/admin/*`, require the `admin` role, a satisfied 2FA session, and the specific permission; sensitive ones require step-up re-auth (`POST /v1/auth/step-up`).
- Idempotency: all mutating endpoints that create bookings or payments require an `Idempotency-Key` header. Mobile generates the key when the user taps, and reuses it on retries.
- Representative endpoints:
  - `POST /v1/bookings`, `GET /v1/bookings/:id`, `POST /v1/bookings/:id/cancel`
  - `GET /v1/bookings/:id/events` (SSE stream of status updates)
  - `POST /v1/bookings/:id/offers/:offerId/accept` and `/decline` (vet)
  - `POST /v1/bookings/:id/status` (en_route, arrived) and `POST /v1/bookings/:id/complete` (vet)
  - `POST /v1/payments/stk`, `GET /v1/payments/:id`
  - `GET/POST /v1/animals`, `GET /v1/animals/:id/history`
  - `POST /v1/uploads/presign`
  - `PATCH /v1/vets/me/availability`, `PUT /v1/vets/me/location`
  - `POST /v1/devices` (register push token)
  - `DELETE /v1/me` (account deletion)
  - `GET /v1/me` (profile, roles, onboarding state, vet verification status, admin permissions)
  - `POST /v1/auth/2fa/verify` (admin TOTP), `POST /v1/auth/step-up`
  - `/v1/admin/vets`, `/v1/admin/bookings`, `/v1/admin/payments`, `/v1/admin/config`, `/v1/admin/users` (permission-gated)
  - Vet application (vet): `GET /v1/vets/me/application` (state + saved draft), `PUT /v1/vets/me/application/steps/:step` (autosave), `POST /v1/uploads/presign` with `kind=vet_document`, `POST /v1/vets/me/application/submit`, `POST /v1/vets/me/application/withdraw`, `POST /v1/vets/me/application/resubmit`
  - Vet application (admin, `verifier`): `GET /v1/admin/vet-applications` (queue), `GET /v1/admin/vet-applications/:id`, `POST /v1/admin/vet-applications/:id/claim`, `POST /v1/admin/vet-applications/:id/decision` (`approve | request_changes | reject | suspend`, with reasons and note), `GET /v1/admin/vet-documents/:id/url` (short-lived signed URL, access logged)
- Webhooks (not for clients): `/webhooks/ussd`, `/webhooks/sms`, `/webhooks/sms/delivery`, `/webhooks/mpesa`.
- Errors: consistent `{ code, message_key, details }`. `message_key` maps into i18n so clients show localized text.
- **Amended by §24:** new endpoints for profiles, avatars, vet practice and fees, nearby vets, chosen bookings, ratings, follow-ups, public profiles, campaigns and referrals (§24.22).
- Support **older app versions**: expose `GET /v1/meta/min-app-version` and force-update gracefully. Never break the API for versions in the wild without a deprecation window.
