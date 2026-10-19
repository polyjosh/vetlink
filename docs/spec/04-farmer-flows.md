# Farmer Flows (USSD, App, Web)

> Part of the VetLink spec. Process rules, commands, guardrails, and the progress tracker are in `/CLAUDE.md`. Section numbers (for example 8.5 or 13) are stable across all spec files; find the file for a section with the map in `/CLAUDE.md` section 0.1 or `docs/spec/README.md`.

## 8. Core Flows (parts: 8.1, 8.2)

### 8.1 Farmer booking: USSD

Shortcode: `*123#` (placeholder, replace with the real code).

```
Welcome / language
  1. Kiswahili  2. English
    │
Main menu
  1. Request vet
  2. My animals
  3. Reminders
  4. History
    │
1 → Animal?
    1. Dairy cow  2. Goat/Sheep  3. Chicken  4. Other
      │
      Problem?
      1. Sick/not eating  2. Injury  3. Breeding/AI
      4. Vaccination      5. EMERGENCY NOW
        │
        Location
        1. Use saved location  2. Enter ward
          │
          Confirm (vet name, ETA, call-out fee)
          1. Confirm and pay deposit  2. Cancel
            │
            STK push (deposit) → SMS with booking ref + vet phone
```

Rules:
- Each screen ≤ 160 characters. Prefix `CON ` (continue) or `END ` (terminate).
- Africa's Talking posts `sessionId`, `serviceCode`, `phoneNumber`, `networkCode`, `text`. `text` is the `*`-joined input history; derive state from it plus server-side session data.
- Returning users skip language and saved-location steps (target: 3 taps to book).
- **Emergency NOW** skips detail, uses saved location, and broadcasts to all eligible vets in range.
- If a session drops after "confirm", the booking must still resolve via SMS.

> **Amended by §24 (Change Set 1, `15-change-set-1.md`):** non-emergency USSD requests add a "choose a vet" screen (fastest, or one of the 3 nearest) and the main menu gains "5. My last vet" (§24.6, §24.9).

### 8.2 Farmer booking: Mobile and Web app

**Onboarding**
1. Choose language (Swahili default if device locale is Swahili).
2. Enter phone number, receive OTP by SMS, verify. Auto-read OTP on Android where permitted.
3. Consent screen (data protection), then choose role: **Farmer** or **Vet/Paravet** (admin is never selectable; see 8.0).
4. Farmer: name, ward (autodetect from location if permitted, else pick), optionally add first animal.

**Home (farmer)**
- Large **"Request Vet"** button. A separate red **"Emergency"** button.
- Cards: active booking, upcoming reminders, my animals.

**Request flow**
1. Select animal from herd (or quick-add: species only).
2. Select problem (icon grid: sick, injury, breeding/AI, vaccination, other) with optional short note or voice note (later).
3. Optional photos (up to 3, compressed to ≤ 500 KB each).
4. Location: map pin defaulting to current GPS, with "use saved farm" option. Fall back to ward picker when GPS is denied or unavailable.
5. Review: matched vet estimate (or "searching"), call-out fee, deposit.
6. Pay deposit via STK push. Show a "check your phone" state and poll or subscribe for confirmation.
7. **Tracking screen:** status timeline (Searching → Vet accepted → On the way → Arrived → Completed), vet name, rating, ETA, one-tap call, cancel button (with clear policy text).
8. After completion: treatment summary, follow-up date, rating prompt, balance payment if applicable.

**Other farmer screens:** My Animals (list, detail, history, photos), Reminders, Booking history, Payments and receipts, Profile and language, Help/contact, Delete my account.

> **Amended by §24 (Change Set 1, `15-change-set-1.md`):** non-emergency requests let the farmer choose the vet from a list and pay the deposit only after the vet accepts (§24.5, §24.6); "when" can be a scheduled slot (§24.10); optional voice note (§24.16). Animals get an optional photo or species placeholder and a health card (§24.2, §24.18). Profile gains photo, username, theme, alerts opt-out, referral code (§24.1, §24.11 to §24.13). "Book my vet again" (§24.9).
