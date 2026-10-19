# Change Set 1: Profiles, Farmer Choice, and Upgrades

> Part of the VetLink spec. Process rules, commands, guardrails, and the progress tracker are in `/CLAUDE.md`. Section numbers (for example 8.5 or 13) are stable across all spec files; find the file for a section with the map in `/CLAUDE.md` section 0.1 or `docs/spec/README.md`.

## 24. Change Set 1 (owner-approved 2026-10-19)

This section **amends** §8.1 to §8.8, §9, §10, §11 to §13 and §17. Where it conflicts with them, this section wins; the amended sections carry a pointer here. It is built in the order of the tracker items CS1 to CS10 (`/CLAUDE.md` 0.8). Every item follows the core invariants: server-side authorization, sw + en strings, channel parity (§2), masked phone numbers in logs.

Items marked **(dep)** need a new dependency, which is proposed and approved in the session that builds it (0.3).

### 24.1 Profiles: photo and username (farmer and vet)

- Every user has an optional **profile photo** and an optional **username**. The username is a **display name only**: login stays phone + OTP (invariant 1).
- Username rules: 3 to 30 characters, letters (any script), digits, spaces, `.`, `_`, `-`; trimmed; must not look like a phone number (7+ digits) or contain a URL. Not unique (it is not an identifier).
- **What the other party sees:**
  - A farmer is shown to their matched vet as `username` if set, else `name`.
  - A vet is always shown with their **verified legal name** (`users.name` from the approved application). If the vet set a username, it appears beside it (`Dr Jane Wanjiru · "Mama Ng'ombe"`). Trust comes from the verified name.
- **Farmer photo:** set or removed freely, live immediately.
- **Vet photo:** the application's `profile_photo` (checked against the ID by a verifier) becomes the vet's public photo on approval. A vet may change it later, but the new photo is held as **pending** and goes to a **photo-only review** in the verifier queue (approve or reject with a reason). Until then farmers keep seeing the old one. Approving or rejecting is audit-logged.
- **Profile screens:**
  - **Farmer profile:** photo, username, name, phone (read-only), language, ward and farm notes, referral code (24.12), notification settings (seasonal alerts opt-out, 24.11), delete account.
  - **Vet profile:** see 24.3.
- Photos are square-cropped and compressed on the device (512 px JPEG, quality 0.7, re-encoded so EXIF is dropped). The server accepts only `image/jpeg` / `image/png` up to 500 KB for avatars.

### 24.2 Animal photos and species placeholders

- Adding or editing an animal accepts **one optional photo** (same pipeline as 24.1: 1024 px, ≤ 500 KB, EXIF dropped). It can be changed or removed later.
- With no photo, every UI shows a **flat SVG illustration for the species**: cattle, goat, sheep, pig, poultry, dog, other (a generic paw). The set lives in `packages/ui-tokens` (one source for web and mobile), uses the ui-tokens palette, works in light and dark themes (24.13), and has a localized accessible label.
- The same visual style is used for empty-state illustrations (no animals, no bookings, no offers, no ratings, offline).
- USSD and SMS are unaffected.

### 24.3 Vet profile and practice details

**Vet profile screen (web and mobile, vet's own view):**
- Header: photo (and pending-review state), verified legal name, username, type (vet / paravet), **Verified** badge and other badges (24.8), rating and count.
- **Species treated** and **services offered**, each service with its **fee** (below).
- **Qualifications:** everything from the approved application: KVB registration number and category, licence expiry (with a renewal warning from 30 days out), qualification, institution, year, practice type and name, years of experience, languages, bio, and the submitted documents (list with upload date and status; the vet can open their own documents through short-lived signed URLs). The national ID is shown masked (last 3 digits only).
- **Practice:** physical premises and call-outs (below), service area, working hours (24.10).
- **Edit rules (§8.3 "Ongoing verification" still applies):** critical fields (name, ID, KVB number, licence, credentials) open a new application version for review. Non-critical fields (species, services, fees within bands, premises, call-outs, radius, working hours, bio, languages, username) apply immediately. The photo follows 24.1.

**Physical premises and call-outs** (asked in wizard step 5 and editable later):
- `offers_call_outs` (yes/no): the vet travels to the farm.
- `has_premises` (yes/no): the vet has a clinic or agrovet a farmer can visit. If yes: premises ward, optional map pin, short directions text, and opening hours.
- At least one of the two must be yes.
- Matching and the vet list (24.6) consider only vets with `offers_call_outs = true` for bookings (every booking is a farm visit today).
- Vets with premises appear to farmers in a separate **"Clinics near you"** list with distance, opening hours and a directions deep link. Clinic-visit bookings (farmer brings the animal, no call-out fee) are a later change.

**Prices** (owner decisions 2026-10-19; amends §8.6 and wizard step 5):
- **Consultation** is the base service of every request. Every vet sets a **consultation fee**; a vet cannot go online without one (`practice_incomplete`, app and SMS `ON`).
- The vet sets a **"from" price for every service they offer**. The farmer may **add services** to the consultation (app and web: optional ticks; the problem pre-ticks vaccination or AI). "Other", or nothing ticked, means consultation only. On USSD the problem implies the services (`servicesForProblem`).
- The **call-out fee** stays a separate travel charge for vets who do call-outs.
- **Total = consultation + added services + call-out**, shown as **"from KES X"** (a starting price: medicine and extra work found on the farm can cost more).
- VetLink's **booking fee** (KES 200, admin-editable as `payments.bookingFeeKes`, stored on each booking) is paid by STK push when booking and **counts towards the total** (§24.24). Screens show both parts: booking fee now to VetLink, the rest to the vet on the farm. Vets see what they collect (`payVet`).
- **Before a vet accepts** (auto mode, emergencies, USSD) the farmer sees the **range** of totals across the vets who could be offered the job; none near means "the vet who accepts confirms the price". **When a vet accepts**, their breakdown is fixed on the booking (`vet_price`); later price changes do not alter it. Offers show each vet their own price for the job.
- Admins set a **minimum and maximum per priced item** (consultation and each service) in config (`fees.serviceBands`); the consultation minimum is never below the booking fee. Changes are audit-logged.
- Matching and the price range consider only vets who do call-outs, have a consultation fee, and offer **every** added service.
- Integers in KES, `>= 0`, always computed by the server; the client never sends a price.

### 24.4 Vet: ratings and follow-ups

- **My ratings** screen (web and mobile): average, count, distribution, and each rating with stars, tags (24.7), optional comment, date, species and booking ID. **The farmer's name is never shown** on this screen.
- **Upcoming follow-ups:** every treatment the vet logged with a `follow_up_date` today or later appears on the vet home as an alert card and in a **Follow-ups** list (date, species, ward, booking ID; farmer name and phone only if the original job was theirs and the follow-up is within 7 days). The vet is notified (push, SMS fallback) the evening before and at 07:00 EAT on the day. Idempotent per treatment and day.
- When the farmer rebooks the follow-up with the same vet (24.9), the card links to the new booking and stops alerting.

### 24.5 Booking modes

Every booking has a `dispatch_mode`:

| Mode | When | Deposit | Who gets the request |
|---|---|---|---|
| `auto` | Emergencies (always); farmer taps "Fastest available vet" | Before dispatch (unchanged §8.5 / §8.6) | Waves (§8.5) |
| `chosen` | Non-emergency; farmer picks a vet | **After the vet accepts** | Only the chosen vet |

Emergency requests are always `auto` (speed beats choice).

### 24.6 Farmer chooses the vet (non-emergency)

**App and web:**
1. Animal, problem, optional photos / voice note, location: as §8.2.
2. **When:** "As soon as possible" or a scheduled time (24.10).
3. **Choose a vet** screen: cards of eligible vets, one per vet, with photo (or placeholder), verified legal name and username, type, **Verified** badge plus badges, rating and count, **distance** (rounded: under 1 km shows "< 1 km", otherwise whole km, prefixed `~`), call-out fee, the fee for the selected service, and languages. Tap a card for the vet's public profile (24.14). Above the list: a **"Fastest available vet"** card, which switches to `auto` mode (pay first, waves).
   - Sort: distance by default; also "Top rated" and "Lowest fee". Shows up to 20 vets.
   - **Eligibility** is §8.5's hard rules plus `offers_call_outs`: approved, serves the species, within radius, under the concurrency limit, and for "as soon as possible" **online** (`is_available`). For a scheduled time the vet need not be online, but the working hours (24.10) must cover the slot.
   - Vet position for distance is the base ward centroid, or the premises pin. **Live location is never used for the list**, so it can never leak a vet's position. Vet coordinates are never sent to the client, only the rounded distance.
   - New vets with no rating are shown as "New" and are not pushed to the bottom (sorting by rating puts them after rated vets, but the default sort is distance).
4. **Review:** the vet, the call-out fee, the service fee ("from"), the KES 200 deposit, and the policy text "You pay the deposit only after the vet accepts."
5. **Send request.** The booking is created in status `requested` with an `Idempotency-Key`. The chosen vet gets a **direct request** (push, SMS fallback, the same offer row as today with `wave = 0`). Response window: **5 minutes** for "as soon as possible", **2 hours** for scheduled (capped at 1 hour before the slot). Both in config.
6. **Vet accepts** → status `awaiting_deposit`, the vet is held, and the server **immediately sends the STK push** to the farmer's phone. The farmer also gets a push/SMS: "Dr X accepted. Enter your M-Pesa PIN to pay the KES 200 deposit." The app shows "Pay deposit" (resend the STK push). The farmer has **5 minutes** (config `booking.chooseFlowMinutes`) to pay.
7. **Deposit confirmed** → `matched`. From here the flow is unchanged (en route, arrived, completed, rating).
8. **Vet declines or does not answer** → status `vet_unavailable`. The farmer is told and is offered: choose another vet (back to step 3, same booking; the declined vet is hidden), switch to "Fastest available vet" (`auto`, pay first), or cancel. Nothing was paid, so there is nothing to refund. After 3 declined/expired choices the farmer is nudged to "Fastest available vet". A booking left in `vet_unavailable` for 10 minutes expires.
9. **Deposit not paid in time** (or it fails and the window passes) → `expired`; the vet is released and told.
10. **Farmer cancels** in `requested`, `vet_unavailable` or `awaiting_deposit`: no money involved. After `matched` the §8.6 rules apply.

**Races (server-enforced, tested):**
- The vet goes offline or is suspended between list and request: the request is refused (`vet_unavailable_now`) and the farmer returns to the list.
- Two farmers request the same vet: both requests are valid; the concurrency limit counts `awaiting_deposit` and active jobs, so a vet at the limit cannot accept another (`at_capacity`).
- The vet accepts at the same moment as the response window closes: one atomic update wins (the §8.5 pattern on `status = 'requested'`).
- A late deposit callback after expiry is refunded automatically (the existing reconciliation and refund path, §8.6).

**USSD (parity, invariant 6):** after problem and location, a new screen:
```
CON Chagua daktari:
1. Haraka zaidi (yeyote)
2. Dr Wanjiru ~3km 4.8*
3. Dr Otieno ~5km 4.5*
4. J. Kamau (AHA) ~6km New
```
Option 1 is `auto` (unchanged flow: confirm, STK, waves). Options 2 to 4 (the 3 nearest eligible online vets) create a `chosen` booking; the session ends with "Request sent to Dr Wanjiru. We will SMS you when they accept, then send the M-Pesa prompt." The rest happens by SMS and STK push (step 6). If the vet declines, the SMS says "Dial *123# to choose another vet." Screens stay within 160 characters (names truncated). Scheduling is not offered on USSD.

**SMS (vets):** a direct request uses the existing offer SMS with "REQUEST" instead of "JOB" and the longer window; `Y`/`N` work unchanged.

**What the vet sees in a direct request:** species, problem, ward, distance, the farmer's animal photos (24.15), the scheduled time if any, and the fees. No farmer identity until `matched` (§17, unchanged).

### 24.7 Rating tags

- Ratings gain optional **tags** from a fixed list: `on_time`, `explained_well`, `fair_price`, `gentle_with_animal`, `animal_recovered`, `would_book_again`, and for low ratings `late`, `unclear_price`, `rude`. Shown as icon chips, localized. The free-text comment stays optional.
- SMS rating (reply `1` to `5`) is unchanged; tags are app and web only.
- Ratings of 2 stars or less with `rude` or repeated low ratings (3 in 30 days) raise an admin review flag (§8.3 "Complaints or low ratings").

### 24.8 Vet badges

Computed on the server (nightly job plus on approval), never self-claimed:

| Badge | Rule |
|---|---|
| `verified` | `verification_status = 'approved'` |
| `top_rated` | rating ≥ 4.5 from at least 10 ratings |
| `fast_responder` | median offer response ≤ 60 s over the last 30 days, from at least 10 offers |
| `jobs_50`, `jobs_100`, `jobs_500` | completed jobs |
| `vaccinations_100` | completed jobs with the vaccination problem type |

Thresholds live in config. A suspended vet shows no badges anywhere.

### 24.9 Book my vet again

- Farmer home and booking history show **"Book Dr X again"** for vets they have completed a job with. It starts a `chosen` request with that vet (24.6), prefilled with the last animal. If the vet is not eligible right now, the card says so and offers a scheduled time or another vet.
- A follow-up reminder (§8.8) for a treatment includes "Book Dr X for the follow-up" (one tap; scheduled on the follow-up date when the vet's hours allow).
- **USSD:** the main menu gains `5. Mpigie daktari wangu` / `5. My last vet`, which makes a `chosen` request to the farmer's most recent vet for the most recent animal and problem, after one confirm screen.

### 24.10 Scheduled appointments and working hours

- Vets set **working hours** per weekday (up to two ranges per day) and can mark days off. Default: Mon to Sat 08:00 to 17:00 EAT.
- For non-emergency `chosen` bookings, the farmer picks **"As soon as possible"** or a **date (next 14 days) and part of day**: morning (08:00 to 12:00), afternoon (12:00 to 16:00), evening (16:00 to 19:00). Parts of day are easier to understand than exact times. Stored as a start time (UTC) plus the part of day.
- Only vets whose working hours overlap the slot are listed. Scheduled bookings count against the vet's concurrency only on the day.
- Reminders to both farmer and vet: the evening before and 1 hour before the slot start.
- **Deposit timing:** the STK push is sent when the vet accepts, as in 24.6 step 6. The cancellation and forfeit rules of §8.6 apply from `matched`; cancelling a scheduled `matched` booking more than 12 hours before the slot refunds the deposit (owner decision may change this; it is in `payments/policy.ts`).
- A scheduled `matched` booking where the vet has not set off 1 hour after the slot start raises an admin alert.
- Not on USSD (USSD bookings are "as soon as possible").

### 24.11 Seasonal and outbreak alerts (farmers, by ward)

- Admins create **alert campaigns**: title and body in sw and en (SMS body ≤ 160 characters each), target (counties, sub-counties or wards; optional species), send date, and channel (push only, or push with SMS fallback).
- The outbreak job (§8.9) **suggests** a campaign when a threshold is crossed; it is **never sent automatically**. An admin reviews and sends it.
- Delivery goes through the notification router, respects quiet hours, and is idempotent per user and campaign. Recipients are farmers whose ward is targeted and who own an animal of a targeted species (or any farmer, if no species).
- Farmers can opt out of seasonal alerts in their profile; on SMS, replying `STOP ALERTS` opts out.
- **Cost guard:** the admin sees the recipient count and SMS estimate before sending; campaigns above the configured SMS cap need `super_admin` with step-up. Creating and sending are `super_admin` only until an admin permission for campaigns is decided. Audit-logged.
- Alerts carry no individual case data, only the area and disease (§17: aggregated outbreak data only).

### 24.12 Referral codes

- Every user gets a short **referral code** (6 characters, no ambiguous letters). Admins can create named **partner codes** for co-ops and agrovets.
- A new user can enter a code at onboarding in the app or web (optional; USSD does not ask). The referrer is stored once and never changed.
- **Attribution only:** the admin console reports sign-ups and first bookings per code and per partner. **No rewards** are paid until the owner decides a reward scheme (new Open Question 21.19).

### 24.13 Modern look and feel

- **Navigation:** bottom tab bar on mobile (expo-router tabs) and on web below the `md` breakpoint; per role: farmer (Home, Animals, Bookings, Profile), vet (Home, Jobs, Ratings, Profile). Admin keeps its own navigation.
- **Loading:** skeleton placeholders instead of spinners for lists and cards.
- **Empty states:** illustration (24.2), one line of text, and the main action.
- **Dark mode:** a dark palette in `@vetlink/ui-tokens`; follows the system setting with an override in the profile (System, Light, Dark). Contrast stays AA in both themes and readable in sunlight in light mode.
- **Haptics (mobile) (dep: `expo-haptics`):** light feedback on accept, decline, status changes, successful payment and errors. Off when the system has haptics disabled.
- Budgets in §11 still apply (install size, cold start). No animation library; use the platform's built-in transitions.

### 24.14 Public vet profile and QR code

- Each approved vet can turn on a **public profile** (opt-in, off by default) at `/v/<slug>` on the web app. The slug is generated (name plus short random suffix) and can be changed once a month.
- It shows only what §8.3 "What farmers see" allows (name, photo, type, Verified and badges, rating, species, services with fees, years of experience, languages, premises with directions if any) and a **"Request this vet"** button (login, then the `chosen` flow with this vet).
- The vet profile screen has **Share** (link) and **QR code** (dep: a QR generator; web and mobile render it as SVG; mobile needs `react-native-svg`, also used by 24.2) for printing at their premises.
- Public profiles are indexable (they are the one public, SEO-relevant page besides marketing). Turning the profile off, suspension, or account deletion makes the page 404 at once.

### 24.15 Photos visible before accepting

- A vet with an open offer or direct request sees the booking's animal photos (thumbnails, then full size) through short-lived signed URLs, so they can bring the right drugs and equipment.
- Photos are the only pre-accept media. Voice notes (24.16) and farmer identity are visible only after `matched`, because they may contain personal data.
- SMS offers say "1 photo in app" when photos exist.

### 24.16 Voice notes

- The farmer can record one **voice note up to 60 seconds** describing the problem (Swahili, English, or any language), in the request flow on app (dep: `expo-audio`) and web (browser MediaRecorder, no dependency).
- Stored as booking media (`booking_voice`), mono, low bitrate (≤ 300 KB), in a private bucket. Played by the assigned vet after `matched`, and by admins with `support`.
- Kept with the booking; removed with the account (§17).

### 24.17 Live vet location on a map (blocked)

While a booking is `en_route`, show the vet's position on a map to the farmer (from opted-in live location, never a trail) with ETA. **Blocked by Open Question 21.10** (map provider and budget). Until then: ETA text and the directions deep link (decision 2026-10-15).

### 24.18 Animal health card

- Each animal has a **health card**: photo or placeholder, species, name or tag, breed, sex, age, and a dated timeline of treatments (diagnosis, drugs), vaccinations, deworming, AI dates and expected calving, follow-ups, and each treating vet's verified name and type.
- **Export as PDF:** web uses a print stylesheet and the browser's "Save as PDF" (no dependency); mobile generates a PDF and opens the share sheet (dep: `expo-print`, `expo-sharing`). The PDF shows the generation date and "Records entered by VetLink-verified vets", and no phone numbers.
- The farmer chooses to share it; nothing is public.

### 24.19 Not in this change set

- WhatsApp channel: stays in Phase 4 (§19).
- Clinic-visit bookings (24.3) and referral rewards (24.12): later, after owner decisions.
- Live map (24.17): after Open Question 21.10.

### 24.24 VetLink's fee: the deposit (decided 2026-10-19)

- **VetLink keeps the whole KES 200 deposit** as its fee. No subscriptions, no percentage commission, no payouts to vets for now.
- **The deposit counts towards the vet's bill.** For a total of "from KES 1,000" the farmer pays KES 200 to VetLink by STK push and from KES 800 to the vet directly on the farm. Every price screen shows both parts; vets see what they collect (total minus KES 200).
- The admin band for the consultation fee starts at KES 200 or more, so the vet's share is never negative.
- Refund rules (§8.6): no vet found or the farmer cancels before the vet sets off: refunded. Cancelled after the vet set off: the deposit is kept by VetLink (previously "forfeited to the vet"; there is no payout path now).
- Revisit (percentage commission and M-Pesa B2C payouts) when the owner wants it; history in the decision log.

### 24.25 Farmer wallet: credit instead of refunds (decided 2026-10-19)

- **No money is ever refunded to M-Pesa.** Wherever the booking fee used to be refunded (no vet found, the farmer cancels before the vet sets off, an admin cancels, a payment that arrives after the booking expired, a vet no-show once the farmer or an admin cancels), the full booking fee is **credited to the farmer's VetLink wallet**, once per booking.
- The next booking fee is **paid from the wallet first**: with enough credit, no M-Pesa prompt at all; otherwise the prompt asks only for the remainder. USSD and SMS say so ("KES 200 paid from your VetLink credit").
- A farmer who cancels **after the vet set off** still loses the fee (the vet made the trip). For **scheduled visits** (§24.10) any cancellation before the vet sets off is credited; the 12-hour rule is dropped.
- **Closed wallet:** credit only pays VetLink booking fees; it cannot be withdrawn, transferred, or paid out. Credit **expires after 12 months without wallet activity**; an unused balance is **lost on account deletion** (the app warns first; stated in the terms). The owner confirms with Safaricom/counsel that this is not e-money.
- An append-only ledger (`wallet_entries`); the balance is the sum; every entry links to its booking; credits and debits are idempotent per booking. Finance admins can view a wallet and post an adjustment with step-up and a written reason (audited).
- Amends §8.6 (refund policy) and §24.24.

### 24.20 Booking state machine (amends §9)

New statuses: `requested`, `vet_unavailable`, `awaiting_deposit`. New events:

| Event | From | To | Actor |
|---|---|---|---|
| `vet_accepted` | `pending` (auto) | `matched` | vet (unchanged) |
| `vet_accepted` | `requested` (chosen) | `awaiting_deposit` | vet |
| `vet_declined_request` | `requested` | `vet_unavailable` | vet |
| `request_timed_out` | `requested` | `vet_unavailable` | system |
| `farmer_rechose` | `vet_unavailable` | `requested` | farmer |
| `farmer_switched_to_auto` | `vet_unavailable` | `pending_payment` | farmer |
| `deposit_confirmed` | `pending_payment` | `pending` | system (unchanged) |
| `deposit_confirmed` | `awaiting_deposit` | `matched` | system |
| `deposit_timed_out` | `awaiting_deposit` | `expired` | system |
| `request_abandoned` | `vet_unavailable` | `expired` | system |
| `farmer_cancelled` | also from `requested`, `vet_unavailable`, `awaiting_deposit` | `cancelled` | farmer |
| `admin_cancelled` | also from the three new statuses | `cancelled` | admin |

`deposit_confirmed` and `vet_accepted` therefore lead to a different status depending on the current one; the transition table maps `from` status to `to` status for these events. `vet_released` is unchanged (`matched` → `pending`): if the chosen vet hands a paid job back, the booking switches to `auto` and is dispatched in waves without a second deposit. The farmer is told "Dr X can't come; we are finding the nearest available vet. Cancel now for a full refund." (the cancel refunds, because no vet is en route; §8.6). Everything still goes through `bookings/transitions.ts` (invariant 3).

```
chosen: requested ─vet_accepted→ awaiting_deposit ─deposit_confirmed→ matched → (unchanged)
            │  ↑                       │
 declined / │  │ farmer_rechose        └─deposit_timed_out→ expired
  timeout   ↓  │
        vet_unavailable ─farmer_switched_to_auto→ pending_payment → (auto flow)
            └─request_abandoned (10 min)→ expired
```

### 24.21 Data model additions (amends §9)

Forward-only migrations; exact names are set in the CS plans.

- `users`: `display_name TEXT`, `avatar_media_id UUID REFERENCES media(id)`, `theme TEXT` (`system|light|dark`), `seasonal_alerts_opt_out BOOLEAN`, `referral_code TEXT UNIQUE`, `referred_by_code TEXT`.
- `vets`: `pending_avatar_media_id UUID`, `offers_call_outs BOOLEAN NOT NULL DEFAULT true`, `has_premises BOOLEAN NOT NULL DEFAULT false`, `premises_ward_id`, `premises_lat`, `premises_lng`, `premises_directions`, `premises_hours JSONB`, `working_hours JSONB`, `badges TEXT[]`, `public_profile_enabled BOOLEAN NOT NULL DEFAULT false`, `public_slug TEXT UNIQUE`, `public_slug_changed_at`. CHECK `offers_call_outs OR has_premises`.
- `vets.consultation_fee`; `vet_service_fees (vet_id, service, fee_from_kes INT CHECK >= 0, PRIMARY KEY (vet_id, service))`, services from `VET_SERVICES`; `vets.premises_hours` is free text.
- `animals`: `photo_media_id UUID REFERENCES media(id)`.
- `media.kind` adds `avatar`, `booking_voice`; `media` gains `review_status` (`none|pending|approved|rejected`) for vet avatars.
- `bookings` (CS2, migration 0010): `services TEXT[]`, `booking_fee_kes INT`, `price_range JSONB`, `vet_price JSONB`. (CS4): `dispatch_mode TEXT NOT NULL DEFAULT 'auto'` (`auto|chosen`), `requested_vet_id UUID REFERENCES vets(user_id)`, `scheduled_for TIMESTAMPTZ`, `scheduled_part TEXT` (`morning|afternoon|evening`), `request_expires_at`, `deposit_due_at`; status CHECK gains the three new statuses.
- `booking_offers`: `kind TEXT NOT NULL DEFAULT 'wave'` (`wave|direct`); direct requests use `wave = 0`.
- `ratings`: `tags TEXT[] NOT NULL DEFAULT '{}'` (subset of `RATING_TAGS`).
- `treatments`: `follow_up_booking_id INT REFERENCES bookings(id)`, `vet_alert_evening_sent_at`, `vet_alert_day_sent_at` (claimed before sending, so alerts go out once). `vets.review_flag_reason`, `vets.review_flagged_at`.
- `alert_campaigns` (id, title/body sw+en, target JSONB, species TEXT[], channel, status `draft|scheduled|sending|sent|cancelled`, send_at, created_by, sent_by, recipient_count, created_at) and `alert_deliveries (campaign_id, user_id, PRIMARY KEY both)` for idempotency.
- `referral_partners` (code, name, kind `coop|agrovet|other`, created_by, created_at).

### 24.22 API additions (amends §10)

Representative; exact shapes in the zod schemas and OpenAPI. All need `Idempotency-Key` where they create bookings or payments.

- `POST /v1/uploads/presign` gains kinds `avatar`, `animal_photo`, `booking_photo`, `booking_voice`; `PUT /v1/me/avatar` (`{ storageKey }`), `DELETE /v1/me/avatar`; presign takes `purpose: photo` with `photoKind`; `PATCH /v1/me` accepts `displayName`, `theme`, `seasonalAlertsOptOut`.
- `PATCH /v1/animals/:id` (edit), `PUT`/`DELETE /v1/animals/:id/photo`, `GET /v1/animals/:id/health-card`.
- `GET /v1/vets/me` (now also prices, practice, qualifications, documents, `practiceMissing`, bands), `PATCH /v1/vets/me/profile` (prices, premises, call-outs, working hours, species, services: non-critical edits), `GET /v1/vets/me/ratings`, `GET /v1/vets/me/follow-ups`, `GET /v1/vets/me/documents/:id/url`, `PATCH /v1/vets/me/public-profile`.
- Farmer: `GET /v1/vets/nearby?species&service&wardId&lat&lng&when&part&sort` (eligible vets for the choose screen), `GET /v1/vets/clinics-nearby`, `GET /v1/vets/:id/public` (farmer view), `GET /v1/farmers/me/recent-vets`.
- `POST /v1/bookings` accepts `dispatchMode`, `vetId` (when `chosen`), `scheduledFor`, `scheduledPart`; `POST /v1/bookings/:id/rechoose` (`{ vetId }`), `POST /v1/bookings/:id/switch-to-auto`, `POST /v1/bookings/:id/deposit/resend`.
- Vet: direct requests appear in the existing offers list with `kind: direct`; accept/decline unchanged.
- Public, no login: `GET /v1/public/vets/:slug`.
- Admin: `GET/POST /v1/admin/vet-photos` (pending photo queue, `verifier`), `/v1/admin/alert-campaigns` (`super_admin`), `/v1/admin/referral-partners` and referral reports (`analyst` read, `super_admin` write), `fees.serviceBands` in `/v1/admin/config`.
- Ratings: `POST /v1/bookings/:id/rating` accepts `tags`. CS3: `GET /v1/vets/me/ratings`, `GET /v1/vets/me/follow-ups` (with `daysAway`), `GET /v1/admin/vets/flagged`, `POST /v1/admin/vets/:userId/review-flag/clear`; vet badges in `GET /v1/vets/me` and the farmer's booking view.
- CS2: `GET /v1/bookings/quote?services=a,b` returns `priceRange`; `POST /v1/bookings` takes `services`; booking, job and offer views carry `services`, `priceRange` and `price` (a `PriceBreakdown`).

### 24.23 Testing additions (amends §16)

- Chosen flow: every new transition, valid and invalid; vet accepts versus window closing (one wins); two farmers choose the same vet at capacity; vet suspended or offline between list and request; deposit expiry releases the vet; late deposit callback after expiry is refunded; rechoose hides declined vets; switch to auto requires the deposit first.
- Gating (invariant 2): an unapproved, suspended, or call-out-off vet never appears in `nearby`, cannot receive a direct request, and cannot accept one (app or SMS).
- Privacy: `nearby` and public profile responses never contain coordinates, phone numbers, ID or KVB documents; ratings for vets never contain farmer names; voice notes are not readable before `matched`.
- USSD: the choose-vet screen and "My last vet" in sw and en, ≤ 160 characters.
- Fees: outside-band service fees are rejected; clients cannot set fees.
- Campaigns: idempotent delivery, opt-out respected, cost guard.
- Follow-up and appointment reminders: idempotent.
- Playwright and Maestro happy paths updated to the chosen flow, plus one emergency (`auto`) path.
