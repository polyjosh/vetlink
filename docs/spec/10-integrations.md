# Integrations

> Part of the VetLink spec. Process rules, commands, guardrails, and the progress tracker are in `/CLAUDE.md`. Section numbers (for example 8.5 or 13) are stable across all spec files; find the file for a section with the map in `/CLAUDE.md` section 0.1 or `docs/spec/README.md`.

## 14. Integrations

**Africa's Talking**
- USSD: `POST /webhooks/ussd`, respond `text/plain` with `CON ...` or `END ...`.
- SMS inbound: `POST /webhooks/sms`; delivery reports: `POST /webhooks/sms/delivery`.
- OTP SMS uses the same account; sender ID registration may be needed.
- Verify webhook origin (IP allowlist and/or secret).

**Safaricom Daraja**
- OAuth token cached until expiry.
- STK Push: `POST /mpesa/stkpush/v1/processrequest`; password is `base64(shortcode + passkey + timestamp)`.
- Callback `POST /webhooks/mpesa`: return 200 quickly, process async.
- Sandbox first. Go-live requires a real paybill/till and approval.

**Push:** Expo Notifications backed by FCM and APNs. Store tokens per device, prune invalid tokens on delivery errors.

**Maps:** provider key restricted per platform (Android package + SHA, iOS bundle ID, web referrer). Budget for map API costs, and cache geocoding results.

**Storage:** S3-compatible with presigned PUT URLs, private by default, short-lived signed GET URLs, and lifecycle rules.

All secrets in environment variables or a secrets manager. Provide `.env.example` with placeholders only.
