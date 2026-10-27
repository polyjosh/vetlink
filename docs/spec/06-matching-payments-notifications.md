# Matching, Payments, Notifications, Reminders, Outbreaks

> Part of the VetLink spec. Process rules, commands, guardrails, and the progress tracker are in `/CLAUDE.md`. Section numbers (for example 8.5 or 13) are stable across all spec files; find the file for a section with the map in `/CLAUDE.md` section 0.1 or `docs/spec/README.md`.

## 8. Core Flows (parts: 8.5 to 8.9)

### 8.5 Matching and dispatch

Goal: find an accepting vet fast without spamming everyone.

**Eligibility (hard rules):**
- `verification_status = 'approved'` (admin-verified), `is_available = true`
- Serves the species (specialties)
- Within max radius (default 25 km rural, 10 km urban; configurable)
- Not already on an active job (or under a concurrency limit)

**Vet position:** use the vet's **live location** if updated in the last 15 minutes and the vet opted in; otherwise fall back to the base ward centroid. Farmer position: pinned coordinates (app/web) or ward centroid (USSD).

**Score (higher is better):**
```
score = 0.40 * proximity_score      // 1 - (distance / max_radius)
      + 0.20 * specialty_match
      + 0.20 * acceptance_rate_30d
      + 0.10 * rating_norm
      + 0.10 * recency_fairness
```
Weights live in config (editable in admin), not in code.

**Dispatch waves:**
1. Wave 1: top 3 vets. Timeout 90s (emergency 45s).
2. Wave 2: next 3, same timeout.
3. Wave 3: radius +50%, top 5.
4. Still none: alert admin, tell the farmer we are still searching, offer the nearest agrovet contact, and refund the deposit if unresolved.
5. **Emergency:** single wave to everyone eligible in range.

> **Amended by §24 (Change Set 1, `15-change-set-1.md`):** waves apply to `auto` bookings (emergencies and "fastest available vet"). Non-emergency `chosen` bookings send one direct request to the farmer's chosen vet (§24.5, §24.6). Eligibility also requires `offers_call_outs`.

**Offer delivery per vet:** push first; if not delivered/acknowledged within ~15s (or vet has no app), send SMS. Record which channel delivered the offer.

**Atomic acceptance (first accept wins, regardless of channel):**
```sql
UPDATE bookings
SET vet_id = $vet, status = 'matched', accepted_at = now()
WHERE id = $booking AND status = 'pending'
RETURNING *;
-- 0 rows → someone else got it; tell this vet "job already taken".
```
Every offer goes into `booking_offers` (wave, channel, sent, responded, response). This is our supply-gap dataset.

### 8.6 Payments

- Deposit (default KES 200) via STK Push at confirmation, from any channel. Balance handling: see Open Question 2.
- Daraja `CustomerPayBillOnline`. Store `CheckoutRequestID` at request time and match the callback to it.
- **Callbacks are untrusted and can arrive late, twice, or never:**
  - Idempotent handler keyed on `CheckoutRequestID` and `MpesaReceiptNumber`
  - Reconciliation job queries STK status for payments stuck `pending` > 2 minutes
  - Booking moves to `pending` (searching) only after a successful deposit record
- In the app, the client never marks a payment successful. It only displays server state.
- Normalize phone numbers to `2547XXXXXXXX` / `2541XXXXXXXX` internally.
- Refund policy: deposit refunded if no vet accepts; forfeited to the vet if the farmer cancels after the vet is en route. **Amended by §24.24:** VetLink keeps the deposit as its fee (it counts towards the vet's bill), and a forfeited deposit stays with VetLink. **Amended by §24.25:** nothing is refunded to M-Pesa; every refund case credits the farmer's VetLink wallet instead. Encode in one place: `payments/policy.ts`.
- **Amended by §24:** for `chosen` bookings the deposit STK push is sent when the vet accepts, with a 10-minute window (§24.6). Vets also show a displayed "from" price per service; VetLink still charges only the deposit (§24.3). Cancelling a scheduled `matched` booking more than 12 hours ahead refunds the deposit (§24.10).
- Note: app store rules on in-app payments apply to digital goods. Payment for a real-world service (vet visit) is generally allowed via external methods like M-Pesa, but verify current Apple and Google policy before submission.

### 8.7 Notifications

One `notifications` service decides the channel; business code never sends SMS or push directly.

Routing: **push first** if the user has an active app device token and notifications enabled; **SMS fallback** for critical events (offer, acceptance, arrival, reminders) if push is unconfirmed; SMS only for users without the app. Respect user language and quiet hours (except emergencies). Keep SMS bodies to a single segment where possible.

### 8.8 Reminders and records

- Completing a treatment can create reminders (booster vaccines, deworming, follow-ups, expected calving from AI date + ~283 days for cattle).
- Daily job at 07:00 EAT sends due reminders via the notification router. Idempotent per reminder.

> **Amended by §24 (Change Set 1, `15-change-set-1.md`):** vets get follow-up alerts (§24.4); scheduled appointments remind both sides (§24.10); follow-up reminders offer one-tap rebooking with the same vet (§24.9).

### 8.9 Outbreak signals

Aggregate `treatments.diagnosis_code` by ward and time window. Flag when a notifiable disease count exceeds a threshold (start simple: ≥ 3 cases of the same disease in a ward within 7 days). Show in the admin dashboard first, with a map and trend chart. County/co-op reporting comes later.

> **Amended by §24 (Change Set 1, `15-change-set-1.md`):** crossing a threshold suggests a farmer alert campaign that an admin reviews and sends; never automatic (§24.11).
