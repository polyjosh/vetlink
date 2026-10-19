# Security, Privacy, Compliance

> Part of the VetLink spec. Process rules, commands, guardrails, and the progress tracker are in `/CLAUDE.md`. Section numbers (for example 8.5 or 13) are stable across all spec files; find the file for a section with the map in `/CLAUDE.md` section 0.1 or `docs/spec/README.md`.

## 17. Security, Privacy, Compliance

- Kenya's **Data Protection Act, 2019** applies. Collect explicit consent at signup (USSD opt-in and app consent screen), minimize data, and plan ODPC registration as a data controller/processor.
- **Account deletion:** users must be able to delete their account and data **inside the app** (also required by Apple and Google store policies), and via web/USSD request. Anonymize records needed for financial and outbreak reporting.
- Location is sensitive. Store ward-level by default; store precise farm coordinates only when the farmer provides them; vet live location is opt-in, short-retention, and never shown to farmers as a raw trail (only ETA).
- Contact details are revealed to the other party only after a booking is matched.
- **Vet identity documents are highly sensitive personal data.** Store in a private, encrypted bucket; national ID number encrypted (with a separate hash for duplicate checks); viewable only by `verifier` and `super_admin` via short-lived signed URLs with every access logged; never exposed to farmers; define a retention policy (e.g. delete documents of rejected/withdrawn applications after a fixed period) and honor account deletion.
- Vet verification is admin-only and audit-logged. KVB numbers verified before approval.
- **Admin hardening (admin features ship in the public app, so assume they are visible to attackers):** admin role granted only by a super admin; mandatory TOTP 2FA with recovery codes; short admin sessions; step-up re-auth for sensitive actions; strict per-permission server checks; rate-limit and alert on failed admin logins; no admin credentials or secrets in the client bundle; every admin action in `audit_log`; regular review and revocation of admin access. Admin endpoints must be safe even if someone reverse-engineers the app and calls them directly.
- OTPs: hashed, short expiry, rate-limited. Tokens in secure storage. Refresh token rotation with revocation.
- Rate-limit webhooks, OTP, and SMS commands. Guard against spoofing and replay.
- Least-privilege DB roles, encrypted backups, tested restores.
- Media: private buckets, signed URLs, strip EXIF location metadata from animal photos unless explicitly needed.
- Use aggregated/anonymized data for outbreak sharing.
- **Change Set 1 (§24):** the vet list never exposes vet coordinates or live location, only rounded distance from the base or premises; public vet profiles are opt-in and show only the §8.3 farmer-visible fields; vets' rating views never show farmer names; voice notes are visible only after a match; avatars and animal photos are re-encoded on the device to drop EXIF; vet avatar changes are reviewed because the photo is an identity check.
