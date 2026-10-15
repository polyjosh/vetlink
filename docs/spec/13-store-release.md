# App Store and Play Store Release

> Part of the VetLink spec. Process rules, commands, guardrails, and the progress tracker are in `/CLAUDE.md`. Section numbers (for example 8.5 or 13) are stable across all spec files; find the file for a section with the map in `/CLAUDE.md` section 0.1 or `docs/spec/README.md`.

## 18. App Store and Play Store Release

Maintain `docs/store-release-checklist.md` and treat store requirements as changing. Verify current policies before each submission.

**Accounts and setup**
- Google Play Console developer account and Apple Developer Program account (organization accounts may require legal entity verification, so start early).
- App IDs, signing keys managed through EAS, bundle ID/package name decided once (`co.ke.vetlink` or similar) since changing later is painful.

**Assets and listings**
- Icons, feature graphic, screenshots on multiple device sizes, short and full descriptions in **English and Swahili**.
- Privacy policy and terms hosted on a public URL. Support contact and website.

**Compliance items**
- Google Play **Data safety** form and Apple **App Privacy** labels must match actual data collection (phone, location, photos, payment info, diagnostics).
- Permission justifications (location, camera, notifications, background location if used).
- In-app **account deletion** flow and a web deletion link (required).
- Health/animal-health claims: we are a booking and records platform, not medical advice for humans. Avoid wording that implies human medical services.
- Payment disclosure: vet services are real-world services paid via M-Pesa. Confirm this remains outside in-app purchase requirements.
- Target the current required Android API level and keep up with Play/Apple minimums.
- Provide reviewer test credentials (a test phone number with a fixed OTP path, or a demo mode) so store reviewers can get past OTP login, with demo **farmer**, **vet**, and **admin** accounts. The demo admin account must be sandboxed (fake data only, limited permissions). Mention in the review notes that the app contains role-based areas for farmers, vets, and staff, so nothing appears hidden. Verify current Apple and Google policy on hidden or role-gated features before submission.

**Release process**
1. Internal testing (Play internal track / TestFlight).
2. Closed beta with pilot co-op users and vets.
3. Staged rollout on Play (e.g. 10% → 50% → 100%). Phased release on iOS.
4. Monitor crash-free sessions (target ≥ 99%), ANRs, and push delivery. Have a rollback/hotfix plan (EAS Update for JS-only fixes where policy allows).
5. Version strategy: semantic versioning, `min-app-version` enforcement on the API for forced upgrades.
