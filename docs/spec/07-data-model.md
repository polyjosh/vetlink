# Data Model

> Part of the VetLink spec. Process rules, commands, guardrails, and the progress tracker are in `/CLAUDE.md`. Section numbers (for example 8.5 or 13) are stable across all spec files; find the file for a section with the map in `/CLAUDE.md` section 0.1 or `docs/spec/README.md`.

## 9. Data Model (PostgreSQL)

Identity is centered on `users`. Farmer and vet are **profiles** attached to a user.

```sql
-- Reference
CREATE TABLE locations (
  id SERIAL PRIMARY KEY,
  county TEXT NOT NULL,
  sub_county TEXT NOT NULL,
  ward TEXT NOT NULL,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  UNIQUE (county, sub_county, ward)
);

-- Identity and auth
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT,                            -- 2547XXXXXXXX; NULL only after deletion (anonymized).
                                         -- CHECK: valid unless deleted; UNIQUE among active users
  name TEXT,
  language TEXT NOT NULL DEFAULT 'sw',   -- 'sw' | 'en'
  roles TEXT[] NOT NULL DEFAULT '{}',    -- farmer, vet. Admin is never stored here: it comes
                                         -- only from an admin_profiles row with revoked_at NULL
  consent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ                 -- soft delete → anonymize job
);

CREATE TABLE otp_codes (
  id SERIAL PRIMARY KEY,
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,               -- never store plain OTPs
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  consumed_at TIMESTAMPTZ,               -- also set when superseded or burned after 5 attempts
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One login on one device. Logout or refresh-token reuse revokes the whole session.
-- Admin 2FA and step-up state live here (server-side), never in the client.
CREATE TABLE auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  device_id UUID REFERENCES devices(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT CHECK (revoked_reason IN ('logout','refresh_token_reuse')),
  mfa_verified_at TIMESTAMPTZ,           -- admin TOTP satisfied on this session (valid 8 h)
  step_up_at TIMESTAMPTZ                 -- fresh TOTP for sensitive admin actions (valid 5 min)
);

CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  session_id UUID NOT NULL REFERENCES auth_sessions(id),
  token_hash TEXT NOT NULL UNIQUE,       -- SHA-256 of a random 256-bit opaque token
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  replaced_by_id UUID REFERENCES refresh_tokens(id),  -- set on rotation
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  platform TEXT NOT NULL CHECK (platform IN ('android','ios','web')),
  push_token TEXT,
  app_version TEXT,
  last_seen_at TIMESTAMPTZ,
  notifications_enabled BOOLEAN NOT NULL DEFAULT true
);

-- Profiles
CREATE TABLE farmers (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  ward_id INT REFERENCES locations(id),
  farm_lat DOUBLE PRECISION,
  farm_lng DOUBLE PRECISION,
  farm_notes TEXT                        -- landmarks, gate colour, etc.
);

CREATE TABLE vets (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('vet','paravet')),
  kvb_reg_no TEXT,
  kvb_category TEXT,
  licence_expiry DATE,
  national_id_enc TEXT,                  -- encrypted at rest
  national_id_hash TEXT,                 -- for duplicate detection only
  qualification TEXT,
  qualification_institution TEXT,
  qualification_year INT,
  practice_type TEXT CHECK (practice_type IN ('independent','clinic','agrovet')),
  practice_name TEXT,
  years_experience INT,
  services TEXT[] NOT NULL DEFAULT '{}',
  languages TEXT[] NOT NULL DEFAULT '{}',
  bio TEXT,
  payout_mpesa_phone TEXT,
  verification_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (verification_status IN ('draft','submitted','under_review',
      'changes_requested','approved','rejected','suspended')),
  verified_at TIMESTAMPTZ,
  specialties TEXT[] NOT NULL DEFAULT '{}',   -- species treated
  ward_id INT REFERENCES locations(id),
  service_radius_km INT NOT NULL DEFAULT 20,
  base_call_out_fee INT,
  rating NUMERIC(2,1),
  is_available BOOLEAN NOT NULL DEFAULT false,  -- CHECK: only when verification_status = 'approved'
  share_live_location BOOLEAN NOT NULL DEFAULT false,
  live_lat DOUBLE PRECISION,
  live_lng DOUBLE PRECISION,
  live_location_at TIMESTAMPTZ
);

CREATE TABLE vet_applications (
  id SERIAL PRIMARY KEY,
  vet_user_id UUID NOT NULL REFERENCES vets(user_id),
  version INT NOT NULL DEFAULT 1,        -- new version for post-approval critical changes
  reference TEXT UNIQUE NOT NULL,        -- e.g. VL-2026-0412
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','under_review','changes_requested',
                      'approved','rejected','withdrawn')),
  created_via TEXT NOT NULL DEFAULT 'self' CHECK (created_via IN ('self','admin_assisted')),
  created_by UUID REFERENCES users(id),  -- the admin, if assisted
  current_step INT NOT NULL DEFAULT 1,   -- resume point for the wizard
  data JSONB NOT NULL DEFAULT '{}',      -- draft answers per step
  submitted_at TIMESTAMPTZ,
  claimed_by UUID REFERENCES users(id),
  claimed_at TIMESTAMPTZ,
  decided_by UUID REFERENCES users(id),
  decided_at TIMESTAMPTZ,
  decision_reasons TEXT[],               -- template keys, localized on display
  decision_note TEXT,                    -- shown to the vet
  internal_note TEXT,                    -- admin-only
  flagged_fields JSONB,                  -- what the vet must fix on changes_requested
  checklist JSONB                        -- reviewer's verification checklist results
);

-- vet_applications.data holds the wizard answers by step (professional_type, personal,
-- credentials, practice, service_area, payout, declaration). The national ID is never stored
-- there in plain text: personal.nationalIdEnc (AES-GCM bound to the application row),
-- nationalIdHash (keyed HMAC, duplicate detection), nationalIdLast3 (shown to the vet).
-- flagged_fields lists `step.field` / `doc.<kind>` the vet must fix in changes_requested.
CREATE TABLE vet_documents (
  id SERIAL PRIMARY KEY,
  application_id INT NOT NULL REFERENCES vet_applications(id),
  vet_user_id UUID NOT NULL REFERENCES vets(user_id),
  kind TEXT NOT NULL,                    -- id_front, id_back, certificate, licence, profile_photo, training_cert
  storage_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded','accepted','flagged')),
  flag_reason TEXT,
  expires_at DATE,                       -- e.g. licence expiry
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ
);

CREATE TABLE admin_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  admin_role TEXT NOT NULL
    CHECK (admin_role IN ('super_admin','verifier','support','finance','analyst')),
  totp_secret_enc TEXT,                  -- encrypted at rest
  totp_enabled BOOLEAN NOT NULL DEFAULT false,
  recovery_codes_hash TEXT[],
  totp_enrol_expires_at TIMESTAMPTZ,     -- TOTP enrolment allowed only before this; set on grant
                                         -- or super-admin 2FA reset (72 h), cleared on enrolment
  granted_by UUID REFERENCES users(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE animals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id UUID NOT NULL REFERENCES farmers(user_id),
  species TEXT NOT NULL,
  name_or_tag TEXT,
  breed TEXT,
  dob DATE,
  sex TEXT
);

CREATE TABLE media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id),
  storage_key TEXT NOT NULL,
  kind TEXT NOT NULL,                    -- animal_photo, booking_photo, treatment_photo
  animal_id UUID REFERENCES animals(id),
  booking_id INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Transactions
CREATE TABLE bookings (
  id SERIAL PRIMARY KEY,                 -- short numeric ID suits SMS replies
  farmer_id UUID NOT NULL REFERENCES farmers(user_id),
  vet_id UUID REFERENCES vets(user_id),
  animal_id UUID REFERENCES animals(id),
  species TEXT NOT NULL,
  problem_type TEXT NOT NULL,
  note TEXT,
  is_emergency BOOLEAN NOT NULL DEFAULT false,
  source_channel TEXT NOT NULL CHECK (source_channel IN ('ussd','sms','app','web','admin')),
  ward_id INT NOT NULL REFERENCES locations(id),
  lat DOUBLE PRECISION,                  -- present when app/web pinned
  lng DOUBLE PRECISION,
  status TEXT NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment','pending','matched','en_route',
                      'in_service','done','cancelled','expired')),
  fee_quoted INT NOT NULL,
  idempotency_key TEXT UNIQUE,           -- from client, prevents double booking
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- Every status change, written by bookings/transitions.ts in the same transaction (append-only).
CREATE TABLE booking_events (
  id SERIAL PRIMARY KEY,
  booking_id INT NOT NULL REFERENCES bookings(id),
  event TEXT NOT NULL,                   -- BOOKING_EVENTS in packages/shared
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('farmer','vet','admin','system')),
  actor_user_id UUID REFERENCES users(id),
  channel TEXT,                          -- ussd | sms | app | web | admin
  reason TEXT,                           -- cancellation reason (fixed list), never PII
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE booking_offers (
  id SERIAL PRIMARY KEY,
  booking_id INT NOT NULL REFERENCES bookings(id),
  vet_id UUID NOT NULL REFERENCES vets(user_id),
  wave INT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('push','sms','both')),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  response TEXT CHECK (response IN ('accepted','declined','timeout'))
);

CREATE TABLE payments (
  id SERIAL PRIMARY KEY,
  booking_id INT NOT NULL REFERENCES bookings(id),
  type TEXT NOT NULL CHECK (type IN ('deposit','balance','refund')),
  amount INT NOT NULL CHECK (amount > 0),     -- KES; direction comes from type
  checkout_request_id TEXT UNIQUE,            -- Daraja STK push id
  merchant_request_id TEXT,
  mpesa_receipt TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','success','failed','cancelled','refunded')),
  phone TEXT,                                 -- payer (deposit) / payee (refund)
  result_code INT,                            -- Daraja ResultCode
  result_desc TEXT,
  refund_of INT UNIQUE REFERENCES payments(id), -- set iff type = 'refund'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- At most one STK push in flight per booking, and never two paid deposits:
CREATE UNIQUE INDEX ON payments (booking_id) WHERE type = 'deposit' AND status = 'pending';
CREATE UNIQUE INDEX ON payments (booking_id) WHERE type = 'deposit' AND status IN ('success','refunded');

CREATE TABLE treatments (
  id SERIAL PRIMARY KEY,
  booking_id INT NOT NULL REFERENCES bookings(id),
  animal_id UUID REFERENCES animals(id),
  diagnosis TEXT,
  diagnosis_code TEXT,                   -- normalized for outbreak queries
  drugs_used TEXT,
  raw_notes TEXT NOT NULL,               -- original SMS or form text
  follow_up_date DATE,
  client_created_at TIMESTAMPTZ,         -- when logged offline on device
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ratings (
  id SERIAL PRIMARY KEY,
  booking_id INT UNIQUE NOT NULL REFERENCES bookings(id),
  stars INT NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reminders (
  id SERIAL PRIMARY KEY,
  animal_id UUID NOT NULL REFERENCES animals(id),
  type TEXT NOT NULL CHECK (type IN ('vaccine','deworm','calving','follow_up')),
  due_date DATE NOT NULL,
  sent_at TIMESTAMPTZ
);

CREATE TABLE notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  payload JSONB NOT NULL,                -- params (rendered in the recipient's language), data
  critical BOOLEAN NOT NULL DEFAULT false, -- push then SMS fallback; ignores quiet hours
  push_sent_at TIMESTAMPTZ,
  push_ticket_id TEXT,                   -- Expo ticket
  push_error TEXT,
  sms_sent_at TIMESTAMPTZ,               -- claimed before sending: never texts twice
  read_at TIMESTAMPTZ,                   -- app confirmed (stops the SMS fallback)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Runtime settings an admin can change (matching weights, radii, waves); defaults in code.
CREATE TABLE app_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ussd_sessions (
  session_id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  state TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id UUID,
  action TEXT NOT NULL,                  -- vet.approved, payment.refunded, config.changed
  entity TEXT NOT NULL,
  entity_id TEXT,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Early indexes
CREATE INDEX ON bookings (status, created_at);
CREATE INDEX ON booking_offers (booking_id);
CREATE INDEX ON vets (ward_id) WHERE verification_status = 'approved' AND is_available;
CREATE INDEX ON treatments (diagnosis_code, created_at);
CREATE INDEX ON devices (user_id);
CREATE INDEX ON auth_sessions (user_id);
CREATE INDEX ON refresh_tokens (session_id);
```

**Booking state machine:**
```
pending_payment ─(deposit ok)→ pending ─(vet accepts)→ matched → en_route → in_service → done
     │                            │
  (fail/expire)            (no vet found)
     ↓                            ↓
  expired                     cancelled + refund
```
Enforce transitions in one function (`bookings/transitions.ts`). No direct status updates elsewhere, from any channel.

The full event table (who may trigger what, from which statuses) is `BOOKING_TRANSITIONS` in `packages/shared/src/bookings.ts`. Beyond the diagram: `farmer_cancelled` from `pending_payment`/`pending`/`matched`/`en_route` (deposit forfeited after `en_route`, §8.6); `vet_released` (`matched` → `pending`, the assigned vet hands the job back); `vet_completed` also from `matched`/`en_route` (SMS vets often skip `ARR`); `admin_cancelled` from any non-terminal status. A test fails if any other source file updates `bookings`.

> **Amended by §24 (Change Set 1, `15-change-set-1.md`):** new statuses `requested`, `vet_unavailable`, `awaiting_deposit` and events for the chosen-vet flow (§24.20); new columns and tables (§24.21).
