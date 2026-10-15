---
description: Review the current diff against the VetLink spec
---
Review the uncommitted changes and the current branch diff. Check against CLAUDE.md:
- server-side authorization on every route, and ownership checks
- booking state changes only via the transition function
- payment idempotency, no trusting the client for success or price
- no PII, OTPs, or tokens in logs; phone numbers masked
- sw and en strings added together; no hardcoded text
- channel parity impact (USSD, SMS, app, web) and role gating
- migrations forward-only; tests cover retries, duplicates, timeouts, races
Report findings by severity with file and line references. Do not change code unless I ask.
