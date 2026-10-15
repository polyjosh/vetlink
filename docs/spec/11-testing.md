# Testing Requirements

> Part of the VetLink spec. Process rules, commands, guardrails, and the progress tracker are in `/CLAUDE.md`. Section numbers (for example 8.5 or 13) are stable across all spec files; find the file for a section with the map in `/CLAUDE.md` section 0.1 or `docs/spec/README.md`.

## 16. Testing Requirements

Must pass before a feature is "done":

- **USSD engine:** table-driven `text` → screen tests, both languages.
- **SMS parser:** spacing, casing, typos, missing IDs.
- **Booking state machine:** valid and invalid transitions from every channel.
- **Matching:** eligibility, scoring order, wave progression, emergency mode, live-location fallback.
- **Race condition:** two vets accept at once (one via app, one via SMS); exactly one wins.
- **Payments:** duplicate callback, late callback, failed payment, stuck-payment reconciliation, retry with the same idempotency key.
- **Auth:** OTP expiry, brute-force lockout, refresh rotation, revoked tokens.
- **Authorization and role routing:** a farmer cannot read another farmer's booking; a vet cannot read unassigned jobs; a non-admin cannot call any `/v1/admin/*` route (including with a forged role claim); admin without 2FA is refused; each admin permission only unlocks its own endpoints; suspended vets cannot go online or accept; the route resolver sends each state in the 8.0 table to the right screen; multi-role switching works; deep links resolve per viewer.
- **Vet verification gating:** a vet in any status other than `approved` is never returned by matching, cannot set `is_available = true`, cannot accept an offer (app or SMS), and gets the "not yet verified" SMS on `ON`; suspension forces offline and cancels open offers; approval does not auto-set online; draft autosave resumes across devices; documents upload with retry; only flagged fields are editable in `changes_requested`; resubmission returns to the queue; the assisting admin cannot approve their own assisted application; licence expiry auto-suspends; critical edits after approval require review while non-critical edits apply immediately.
- **Notifications:** push-then-SMS fallback, quiet hours, emergency override.
- **Reminders:** idempotency.
- **Offline (mobile):** complete a job with no connectivity, kill the app, relaunch, reconnect, and verify exactly-once sync.
- **App E2E (Maestro/Playwright):** farmer books, vet accepts, job completes, farmer rates. Run on Android in CI.
- **Cross-channel:** book by USSD, then see and cancel it in the app.
- **Accessibility and low-end checks:** manual pass on a low-end Android before each release.
