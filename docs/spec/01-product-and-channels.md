# Product, Channels, and Users

> Part of the VetLink spec. Process rules, commands, guardrails, and the progress tracker are in `/CLAUDE.md`. Section numbers (for example 8.5 or 13) are stable across all spec files; find the file for a section with the map in `/CLAUDE.md` section 0.1 or `docs/spec/README.md`.

## 2. Channels (one platform, four front doors)

VetLink is **omnichannel**. Every channel is a thin adapter over the same backend and the same business rules. A booking made on USSD must be visible and manageable in the app, and vice versa.

| Channel | Who | Why it exists |
|---|---|---|
| **USSD** (`*123#`) | Farmers | Works on any phone, no data, no install |
| **SMS** | Farmers (notifications), vets (commands) | Reliable fallback when data or push fails |
| **Mobile app** (Android + iOS, in app stores) | Farmers, vets, admins | One app for all roles: maps, photos, live status, push, offline mode |
| **Web app** (responsive, PWA-capable) | Farmers, vets, admins | Same app on the web: no install, works on desktop; full admin console |

**Identity rule:** the **phone number is the account** across all channels. A farmer who books via USSD today and installs the app tomorrow logs in with the same number (OTP) and sees the same animals and history.

### One app, three roles

There is **one app** (one mobile binary in the stores, one web app). Farmers, vets, and admins all sign in through the same login screen. After login, the user is **routed to the experience for their role**. There is no separate admin app or vet app.

- **Farmer** → farmer home (request vet, animals, reminders)
- **Vet / paravet** → vet home (online toggle, offers, active job)
- **Admin** → admin console (verification, bookings, payments, analytics)

Full routing rules are in section 8.0. Access control is enforced **on the server**, never by hiding screens in the client.

### Channel parity matrix

| Capability | USSD | SMS | Mobile app | Web app |
|---|:-:|:-:|:-:|:-:|
| Request vet (incl. emergency) | ✅ | | ✅ | ✅ |
| Pin exact farm location on map | | | ✅ | ✅ |
| Attach photos of animal | | | ✅ | ✅ |
| Pay deposit (STK push) | ✅ | | ✅ | ✅ |
| Track booking status live | | ✅ (updates) | ✅ (push + live) | ✅ |
| Manage animals / herd records | basic | | ✅ | ✅ |
| Reminders | | ✅ | ✅ (push + SMS) | ✅ |
| Vet: receive and accept jobs | | ✅ | ✅ (push) | ✅ |
| Vet: log treatment | | ✅ (command) | ✅ (form, offline) | ✅ |
| Vet: earnings and history | | | ✅ | ✅ |
| Rate the vet | | ✅ (reply 1-5) | ✅ | ✅ |
| Admin operations | | | ✅ (essentials) | ✅ (full console) |
| Choose a specific vet (§24.6) | ✅ (3 nearest) | | ✅ | ✅ |
| Book my last vet again (§24.9) | ✅ | | ✅ | ✅ |
| Scheduled appointment (§24.10) | | | ✅ | ✅ |
| Profile photo, username, animal photos (§24.1, §24.2) | | | ✅ | ✅ |
| Voice note with request (§24.16) | | | ✅ | ✅ |
| Animal health card PDF (§24.18) | | | ✅ | ✅ |
| Seasonal alerts (§24.11) | | ✅ | ✅ (push) | ✅ |

Rule: **anything a farmer can do on USSD must also be doable in the app and web**, but not the reverse.

## 3. Users

| User | Typical device | Channels | Primary need |
|---|---|---|---|
| Farmer | Feature phone or low-end Android | USSD, SMS, app, web | Get a vet fast, keep records, get reminders |
| Vet / paravet | Low-end to mid-range Android, some iPhones | App (primary), SMS fallback, web | Receive jobs, accept, navigate, log treatment, get paid |
| Admin (us) | Laptop and phone | Web app (full console), mobile app (essentials) | Verify vets, resolve disputes, monitor supply and demand |
| County vet office / co-op (later) | Laptop | Web reports | Outbreak signals, coverage data |

A single user can hold **multiple roles** (e.g. a paravet who also keeps cows, or an admin who is also a vet). Multi-role users get a role switcher (section 8.0). The **admin role is never self-assigned**; it is granted only by a super admin.

## 7. Domain Glossary

- **Vet:** registered veterinary surgeon (Kenya Veterinary Board).
- **Paravet / AHA:** animal health assistant/technician, a registered paraprofessional. Handles basic treatment, vaccination, AI.
- **AI:** artificial insemination (breeding), not the other kind.
- **ECF:** East Coast fever. **FMD:** foot-and-mouth disease. **LSD:** lumpy skin disease. **Mastitis:** udder infection.
- **Ward / sub-county / county:** Kenya's administrative hierarchy. Ward is the base location unit for USSD; the app can add precise coordinates.
- **STK Push:** M-Pesa prompt sent to the farmer's phone to enter their PIN.
- **Call-out fee:** the vet's fee to come to the farm, set by distance band. Treatment costs are separate.
