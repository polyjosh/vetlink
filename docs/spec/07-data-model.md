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
  phone TEXT UNIQUE NOT NULL,            -- 2547XXXXXXXX
  name TEXT,
  language TEXT NOT NULL DEFAULT 'sw',   -- 'sw' | 'en'
  roles TEXT[] NOT NULL DEFAULT '{}',    -- farmer, vet, admin (admin only via admin_profiles)
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
  consumed_at TIMESTAMPTZ
);

CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL,
  device_id UUID,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
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
  is_available BOOLEAN NOT NULL DEFAULT false,
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
  amount INT NOT NULL,
  checkout_request_id TEXT UNIQUE,
  mpesa_receipt TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','success','failed','cancelled','refunded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
  payload JSONB NOT NULL,
  push_sent_at TIMESTAMPTZ,
  sms_sent_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ
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
