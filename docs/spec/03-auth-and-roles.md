# Login, Roles, and Access

> Part of the VetLink spec. Process rules, commands, guardrails, and the progress tracker are in `/CLAUDE.md`. Section numbers (for example 8.5 or 13) are stable across all spec files; find the file for a section with the map in `/CLAUDE.md` section 0.1 or `docs/spec/README.md`.

## 8. Core Flows (part: 8.0)

### 8.0 Login and role-based routing

One login for everyone: phone number → SMS OTP → verified. What happens next depends on who the user is.

**Client route resolver (runs after login and on app start):**

| User state | Destination |
|---|---|
| No roles yet / onboarding incomplete | Onboarding: language → consent → choose **Farmer** or **Vet/Paravet** (Admin is never offered) |
| Farmer only | Farmer home |
| Vet, `draft` (no application submitted) | **Application wizard** (resumes at the last saved step) |
| Vet, `submitted` or `under_review` | **Application status screen**, read-only, "under review". Cannot go online |
| Vet, `changes_requested` | Status screen listing what to fix, with only the flagged sections editable and a **Resubmit** button |
| Vet, `rejected` or `suspended` | Status screen with reason and appeal/support contact. Cannot go online |
| Vet, `approved` | Vet home (first time: short orientation, then **Go online** is enabled) |
| Admin | **Step-up 2FA** (authenticator code), then admin console |
| Multiple roles | Last-used role's home, plus a **role switcher** in the header/profile menu |

**Rules:**
- The API's `GET /v1/me` returns `roles`, onboarding state, vet verification status, and admin permissions. The client routes from this response; it never infers roles locally.
- Route groups `(farmer)`, `(vet)`, `(admin)` (mobile) and `/farmer`, `/vet`, `/admin` (web) each have a **layout guard** that checks the role and redirects if it does not match. Guards are UX only. **Every API endpoint independently enforces role and ownership** (a farmer only sees their own bookings, a vet only bookings offered to or assigned to them, admins per permission).
- Deep links resolve by the viewer's relationship to the object: `vetlink://booking/:id` opens the farmer tracking screen for the booking's farmer, the job screen for the assigned vet, and the admin booking view for an admin.
- Role switching does not require re-login, but switching **into** admin requires a valid recent 2FA session.
- **Admin accounts** are created or granted only by a super admin (or a seeded bootstrap script for the first one). Admin is never reachable via self-signup, USSD, or SMS.
- **Admin permissions:** `super_admin`, `verifier` (vet approvals), `support` (bookings, users), `finance` (payments, refunds, payouts), `analyst` (read-only dashboards). Every admin endpoint declares the permission it needs.
- **Sensitive admin actions** (refunds, config changes, role grants, suspending a vet) require step-up re-authentication (fresh 2FA within the last few minutes) and are written to `audit_log`.
- Unauthorized access attempts return the same generic error as "not found" where revealing existence would leak information, and are logged.
