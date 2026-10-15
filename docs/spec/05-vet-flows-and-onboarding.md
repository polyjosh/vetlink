# Vet Flows, Onboarding, and Verification

> Part of the VetLink spec. Process rules, commands, guardrails, and the progress tracker are in `/CLAUDE.md`. Section numbers (for example 8.5 or 13) are stable across all spec files; find the file for a section with the map in `/CLAUDE.md` section 0.1 or `docs/spec/README.md`.

## 8. Core Flows (parts: 8.3, 8.4)

### 8.3 Vet flow: Mobile and Web app (primary)

#### Vet onboarding and verification (application)

**Hard rule: a vet receives no farmer requests until an admin has approved their application.** No offers, no matching, no online toggle, no SMS job offers. This is enforced on the server (see "Gating rules" below), not just in the UI.

**Verification status lifecycle**
```
draft ──submit──→ submitted ──admin claims──→ under_review
                                                 │
                     ┌───────────────────────────┼───────────────────────┐
                     ↓                           ↓                       ↓
                 approved               changes_requested            rejected
                     │                           │ (vet fixes + resubmits → submitted)
                     ↓
                 suspended ⇄ approved   (admin action, reason required)

Vet can withdraw a submitted application (→ draft) to edit it before review starts.
```

**Application wizard (same steps on mobile and web)**

After OTP signup and choosing the Vet/Paravet role, the vet completes a step-by-step form. Progress bar ("Step 3 of 7"), big Next/Back buttons, one topic per screen, all text via i18n (sw/en).

| Step | What the vet enters | Notes |
|---|---|---|
| 1. Professional type | Veterinary surgeon or Paravet / animal health assistant | Decides which credentials are required |
| 2. Personal details | Full name (as on ID), national ID number, profile photo (clear face), email (optional) | Phone is prefilled from OTP login and locked |
| 3. Credentials | KVB registration number, registration category, licence expiry date, qualification and institution, year qualified. **Uploads:** certificate, practising licence, ID photo (front and back). Paravets: training certificate, plus employer/supervising vet name if applicable | Expiry date drives re-verification |
| 4. Practice details | Independent / clinic / agrovet-attached, practice name (optional), years of experience, species treated, services offered (treatment, vaccination, AI, deworming, pregnancy diagnosis, minor surgery), languages spoken, short bio | Species and services feed matching |
| 5. Service area and fees | Base location (county → sub-county → ward, or pin on map), service radius, extra wards served, base call-out fee and distance bands (within admin-set min/max), typical availability hours, emergency callouts yes/no | Fee bands validated against admin config |
| 6. Payout details | M-Pesa number for payouts (defaults to login number) | Registered name should match the applicant's name |
| 7. Review and declare | Read-only summary with an "Edit" link per section, accept Terms and Code of Conduct, consent to identity and registration verification, declare information is true | Submit button disabled until everything required is complete |

Illustrative screen (step 3, mobile):
```
┌──────────────────────────────┐
│ ← Credentials      Step 3 of 7│
│ ▓▓▓▓▓▓▓░░░░░░░░░░░░░░░       │
│                              │
│ KVB registration number      │
│ [ ______________________ ]   │
│                              │
│ Licence expiry date          │
│ [ DD / MM / YYYY  📅 ]       │
│                              │
│ Upload your documents        │
│ ┌────────────┐ ┌───────────┐ │
│ │ 📷 Certificate│ │ 📷 Licence │ │
│ │  ✓ Added   │ │  + Add    │ │
│ └────────────┘ └───────────┘ │
│ Photo tips: flat, well lit,  │
│ all corners visible.         │
│                              │
│ [ Save and continue later ]  │
│ [        Next  →         ]   │
└──────────────────────────────┘
```

**Wizard behaviour**
- **Autosave** to the server after every step (`draft`), so the vet can resume on another device. Also offer "Save and continue later".
- **Weak connectivity:** documents upload in the background with retry, resumable, with progress and a clear "uploaded" tick. Images compressed on device (target ≤ 1 MB, still legible). Web also accepts PDF. Allowed types: JPG, PNG, PDF. Enforce size limits.
- **Camera capture** with guidance overlay, preview, and retake. Gallery pick also allowed.
- **Validation:** inline, field-level, in plain language (KVB number format, ID number, dates not in the past for licence expiry, radius and fee within limits, at least one species). Errors say how to fix, not just what is wrong.
- Required-document checklist visible throughout; **Submit** is enabled only when all required fields and documents are present.
- On submit: confirmation screen with reference number, what happens next, expected review time (placeholder target: 48 hours, see Open Questions), and support contact. Send confirmation by push and SMS.
- After submit the application is **read-only** (status `submitted`). The vet may **withdraw** it back to draft only until an admin claims it.

**Application status screen (the vet's "home" until approved)**
```
┌──────────────────────────────┐
│ Your application             │
│ Ref: VL-2026-0412            │
│                              │
│ ● Submitted   ✓ 30 Sep       │
│ ● Under review  ← you are here│
│ ○ Decision                   │
│                              │
│ We usually reply within 48h. │
│ You cannot receive requests  │
│ until you are approved.      │
│                              │
│ [ View my application ]      │
│ [ Contact support ]          │
└──────────────────────────────┘
```
Per state:
- **draft:** "Continue application".
- **submitted / under_review:** timeline, read-only summary, withdraw (only while `submitted`), support contact.
- **changes_requested:** list of the specific items the admin flagged, each with the admin's comment (e.g. "Certificate photo is blurry, please retake"); only flagged fields and documents are editable; **Resubmit** button returns it to `submitted` and to the front of the queue.
- **rejected:** plain-language reason, whether reapplication is allowed and when, and how to appeal via support.
- **approved:** congratulations, a short orientation (how offers work, response times, fees, Code of Conduct, ratings), then **Go online** unlocks.
- **suspended:** reason category, support contact; the vet is forced offline and receives no offers.

**Gating rules (server-enforced, tested)**
- Matching eligibility requires `verification_status = 'approved'`. Anything else is never offered a job.
- `PATCH /v1/vets/me/availability` rejects `is_available = true` unless approved. Suspension forces `is_available = false` immediately and cancels any open offers.
- Accepting an offer, and every SMS command (`Y`, `ON`, etc.), re-checks approval. An unapproved vet texting `ON` receives: "Your VetLink account is not yet verified. We will SMS you when it is approved."
- Push tokens of unapproved vets are never used for offers.
- Vets created by admins (pilot, or assisted onboarding) go through the **same** approval. The admin who entered the application on the vet's behalf cannot be the one who approves it (four-eyes).

**Admin review (Admin console, `verifier` permission)**
- **Queue:** oldest first, with review-time SLA indicator, filters (status, county, type, resubmission), and claim/assign so two reviewers don't work the same application.
- **Application detail:** all submitted details beside the documents (zoom, rotate, side-by-side with the ID and selfie), plus a **verification checklist** the reviewer completes:
  1. Identity: ID document matches the name, number, and profile photo.
  2. KVB registration: number is valid and in good standing (manual register lookup at MVP; record date and result).
  3. Certificate and licence: authentic-looking, name matches, not expired.
  4. Practice and service area: plausible for the stated species and services.
  5. Fees within the configured bands.
  6. Duplicate check: same ID number, KVB number, or phone not already registered (system-flagged).
  7. Payout M-Pesa name matches the applicant.
- **Decisions** (each writes an audit log entry with reviewer, timestamp, and reason):
  - **Approve:** sets `approved`, `verified_at`; vet is notified. Vet still has to go online themselves to receive requests.
  - **Request changes:** select the exact fields/documents at fault, choose from bilingual reason templates and/or add a comment; status → `changes_requested`.
  - **Reject:** reason category (e.g. unverifiable registration, fraudulent documents, outside service area) plus a note shown to the vet; internal notes stay admin-only.
  - **Suspend (later, on approved vets):** reason required; forces offline.
- **Assisted onboarding:** an admin can fill the application on behalf of a vet who struggles with the UI, but the vet must confirm via OTP consent, and the four-eyes rule applies.
- Document access uses short-lived signed URLs and every view is logged.

**Ongoing verification**
- **Licence expiry:** notify the vet 30 and 7 days before expiry. On expiry, auto-suspend (forced offline) until a renewed licence is submitted and approved.
- **Critical field changes after approval** (name, ID, KVB number, licence, credentials) create a new application version that must be reviewed; the change does not take effect until approved. **Non-critical edits** (fees within bands, radius, hours, bio, species) apply immediately.
- **Complaints or low ratings** can trigger an admin review flag.

**What farmers see:** only name, profile photo, type (vet / paravet), a **Verified** badge, rating, species and services, years of experience, and languages. Never ID numbers, documents, or payout details.

**Notifications** (via the notification router, in the user's language): application submitted, changes requested, approved, rejected, suspended, licence expiring.

**Home (vet)**
- Big **Online / Offline** toggle. While online, optionally share live location (opt-in, explained in plain language) to improve matching and ETAs.
- Cards: incoming offers, active job, today's earnings.

**Job offer**
- Full-screen push notification and in-app card: species, problem, distance, call-out fee, ward, countdown timer (90s; emergency 45s).
- Buttons: **Accept** / **Decline**. First accept wins (see 8.5). If someone else won, show a friendly "job already taken" screen.

**Active job**
1. After accept: farmer name, masked landmark notes, call button, **Navigate** (deep link to Google Maps or Waze), photos of the animal.
2. Status buttons: **On my way** → **Arrived** → **Complete job**.
3. **Complete job form:** diagnosis (searchable list of common conditions plus free text), drugs used, notes, follow-up date, optional photos. Works fully offline and syncs later.
4. Balance collection per the payments decision (Open Question 2).

**Other vet screens:** Job history, Earnings (per job, weekly, payout status), Ratings and feedback, Coverage and fee settings, Profile and documents, Support, Delete my account.

**SMS fallback for vets:** a vet who is offline or without data still receives offers by SMS and can reply with commands (see 8.4). Everything a vet does by SMS must produce the same result as the app.

### 8.4 Vet SMS commands

**Inbound offer to vet (sent only when the app push is not delivered or the vet has no app):**
```
VETLINK JOB 4821
Dairy cow, sick, Ndumberi (~6km)
Call-out KES 800
Reply Y4821 to accept, N4821 to decline
```

| Command | Meaning | Response |
|---|---|---|
| `Y4821` | Accept job | Farmer name, phone, ward, landmark notes |
| `N4821` | Decline | Ack; next wave proceeds |
| `OTW 4821` | En route | Farmer notified with ETA |
| `ARR 4821` | Arrived | Status → in service |
| `DONE 4821 ECF; oxytet 20ml; f/u 7d` | Complete job | Parsed into diagnosis, drugs, follow-up |
| `ON` / `OFF` | Toggle availability | Ack |
| `HELP` | List commands | Menu |

Parsing rules: forgiving on spacing and case (`y 4821`, `yes 4821`); store raw text first, then parse best-effort; never reject a completion because parsing failed; unknown commands get a short help reply.
