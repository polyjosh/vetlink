# USSD flows (as built)

The farmer USSD channel (§8.1). Engine: `apps/api/src/modules/ussd/engine.ts`. All text is in
the `ussd` namespace of `packages/i18n` (sw and en). Every screen is at most 160 characters
including the `CON `/`END ` prefix (tested).

## Callback

`POST /webhooks/ussd?token=<WEBHOOK_SECRET>` from Africa's Talking (form-encoded
`sessionId, serviceCode, phoneNumber, networkCode, text`), answered `text/plain` with
`CON …` or `END …`. The token is required in production. Requests are rate-limited per phone
(60 per 10 minutes). Phone numbers and typed text are never logged.

## Menus

```
New number (no consent yet)
  Karibu VetLink / Welcome: 1. Kiswahili 2. English
  Consent: 1. I agree 2. I do not agree      → creates the account: language, consent,
                                               farmer role and profile
Main menu
  1. Request vet
     Animal: 1. Dairy cow 2. Goat/Sheep 3. Chicken 4. Other
     Problem: 1. Sick 2. Injury 3. Breeding/AI 4. Vaccination 5. EMERGENCY NOW
     Location: 1. <saved ward> 2. Another ward  (skipped for EMERGENCY with a saved ward;
               asked directly when there is no saved ward)
       Ward search: type a name, pick from up to 5 matches (typing text again re-searches)
     Confirm: animal, problem, ward, call-out fee (pay the vet), KES 200 deposit
       1. Confirm and pay → booking (channel ussd) → END with reference
       2. Cancel → END
  2. My animals: list (up to 5), 1. Add animal → species → name/tag → saved
  3. Reminders: next 3 upcoming
  4. History: last 3 requests with status
```

Returning users go straight to the main menu: Request, animal, problem, saved ward, confirm is
5 taps. Invalid input re-shows the same screen with "Invalid choice."

## Rules

- **Replay:** Africa's Talking sends the whole input history each time, so each request replays
  it from the start. The session's starting point (needs onboarding, language, saved ward) is
  stored in `ussd_sessions.data` on the first request, so replays stay stable after a step has
  written data.
- **Exactly once:** a booking uses idempotency key `ussd-<sessionId>`, so a resent final
  request returns the same booking. Adding an animal is guarded by the session state.
- **Mapping:** "Goat/Sheep" books as `goat`; EMERGENCY books `problem_type = sick` with
  `is_emergency = true`. The first booked ward is saved to the farmer profile.
- **Parity:** USSD bookings are ordinary bookings, visible and cancellable in the app and on
  the web for the same number (tested).
- **Deposit:** the M-Pesa STK push is sent from the confirm step once payments land (M7).

## Simulator

`pnpm ussd:sim` (API running) dials as the seeded demo farmer; `-- --phone 07…` for another
number. It sends `WEBHOOK_SECRET` from `.env` when set.
