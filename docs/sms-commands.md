# SMS commands (as built)

Vets without data (and farmers rating a visit) use SMS (§8.4). Parser:
`apps/api/src/modules/sms/parser.ts`; flows: `apps/api/src/modules/sms/service.ts`. Every command
calls the same service as the app, so results are identical: approval is re-checked, the first
accept wins across channels, and a repeated step or completion is a no-op.

## Callback

`POST /webhooks/sms?token=<WEBHOOK_SECRET>` from Africa's Talking (form-encoded `from, text, id, to,
date, linkId, networkCode`; field names to be confirmed against the AT dashboard at go-live).
Each message is stored in `sms_inbound` before parsing. A repeated `id` is ignored, so provider
retries never act twice. The reply goes back as an SMS (also in the response body with
`SMS_MODE=log`). Delivery reports: `POST /webhooks/sms/delivery`. 30 messages per 10 minutes per
number. Numbers and text are never logged.

## Vet commands

| Send | Meaning | Reply |
|---|---|---|
| `Y4821` | accept job 4821 | the farmer's name, phone, ward and landmarks |
| `N4821` | decline | ack; the next wave goes out once the whole wave has answered |
| `OTW 4821` | on my way | ack; the farmer is told |
| `ARR 4821` | arrived | ack; status `in_service`; the farmer is told |
| `DONE 4821 ECF; oxytet 20ml; f/u 7d` | complete | ack; treatment saved; the farmer is told and asked to rate |
| `ON` / `OFF` | online / offline | ack (`ON` only once approved) |
| `HELP` | the commands | menu |

Forgiving input: any case or spacing, `y 4821`, `yes4821`, `Y-4821`, `on the way 4821`, Swahili
(`ndio`, `hapana`, `njiani`, `nimefika`, `maliza`, `msaada`), and one-letter typos in words of 4+
letters (`DOEN`, `HLEP`). Without a number, the vet's only open offer (for `Y`/`N`) or only active
job (for `OTW`/`ARR`/`DONE`) is used; otherwise the reply asks which job.

`DONE` notes are split on `;` (or `,` not between digits): the first part is the diagnosis
(recognized conditions get a `diagnosis_code` for outbreak counts: ECF, FMD, LSD, mastitis,
anthrax, rabies, PPR, CCPP, CBPP, Newcastle, ASF, black quarter…), `f/u 7d` / `follow up 2 weeks`
/ `rudi siku 3` sets the follow-up date (and a follow-up reminder when the animal is known), and the
rest is drugs. The raw text is always stored, and a completion is never rejected because its
notes did not parse.

An unapproved vet sending `ON` or `Y…` gets: "Your VetLink account is not yet verified. We will
SMS you when it is approved." (§8.3). Farmers sending vet commands get the farmer help.

## Farmer rating

`R4821 5` (optionally followed by a comment); `R` with no number rates the latest finished,
unrated visit. A retry with the same stars is fine; a farmer can only rate their own visits.

## Simulator

`pnpm --filter api sms:sim -- --phone 0700000002 "Y4"` sends one inbound SMS to the running API
and prints the reply (with `SMS_MODE=log`).
