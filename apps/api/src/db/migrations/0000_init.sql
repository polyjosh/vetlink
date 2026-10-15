CREATE TABLE "animals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"farmer_id" uuid NOT NULL,
	"species" text NOT NULL,
	"name_or_tag" text,
	"breed" text,
	"dob" date,
	"sex" text
);
--> statement-breakpoint
CREATE TABLE "booking_offers" (
	"id" serial PRIMARY KEY NOT NULL,
	"booking_id" integer NOT NULL,
	"vet_id" uuid NOT NULL,
	"wave" integer NOT NULL,
	"channel" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	"response" text,
	CONSTRAINT "booking_offers_channel_check" CHECK ("booking_offers"."channel" in ('push', 'sms', 'both')),
	CONSTRAINT "booking_offers_response_check" CHECK ("booking_offers"."response" in ('accepted', 'declined', 'timeout'))
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" serial PRIMARY KEY NOT NULL,
	"farmer_id" uuid NOT NULL,
	"vet_id" uuid,
	"animal_id" uuid,
	"species" text NOT NULL,
	"problem_type" text NOT NULL,
	"note" text,
	"is_emergency" boolean DEFAULT false NOT NULL,
	"source_channel" text NOT NULL,
	"ward_id" integer NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"status" text DEFAULT 'pending_payment' NOT NULL,
	"fee_quoted" integer NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "bookings_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "bookings_source_channel_check" CHECK ("bookings"."source_channel" in ('ussd', 'sms', 'app', 'web', 'admin')),
	CONSTRAINT "bookings_status_check" CHECK ("bookings"."status" in ('pending_payment', 'pending', 'matched', 'en_route', 'in_service', 'done', 'cancelled', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"kind" text NOT NULL,
	"animal_id" uuid,
	"booking_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"booking_id" integer NOT NULL,
	"type" text NOT NULL,
	"amount" integer NOT NULL,
	"checkout_request_id" text,
	"mpesa_receipt" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_checkout_request_id_unique" UNIQUE("checkout_request_id"),
	CONSTRAINT "payments_mpesa_receipt_unique" UNIQUE("mpesa_receipt"),
	CONSTRAINT "payments_type_check" CHECK ("payments"."type" in ('deposit', 'balance', 'refund')),
	CONSTRAINT "payments_status_check" CHECK ("payments"."status" in ('pending', 'success', 'failed', 'cancelled', 'refunded'))
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"id" serial PRIMARY KEY NOT NULL,
	"booking_id" integer NOT NULL,
	"stars" integer NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ratings_booking_id_unique" UNIQUE("booking_id"),
	CONSTRAINT "ratings_stars_check" CHECK ("ratings"."stars" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" serial PRIMARY KEY NOT NULL,
	"animal_id" uuid NOT NULL,
	"type" text NOT NULL,
	"due_date" date NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "reminders_type_check" CHECK ("reminders"."type" in ('vaccine', 'deworm', 'calving', 'follow_up'))
);
--> statement-breakpoint
CREATE TABLE "treatments" (
	"id" serial PRIMARY KEY NOT NULL,
	"booking_id" integer NOT NULL,
	"animal_id" uuid,
	"diagnosis" text,
	"diagnosis_code" text,
	"drugs_used" text,
	"raw_notes" text NOT NULL,
	"follow_up_date" date,
	"client_created_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"admin_role" text NOT NULL,
	"totp_secret_enc" text,
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"recovery_codes_hash" text[],
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "admin_profiles_admin_role_check" CHECK ("admin_profiles"."admin_role" in ('super_admin', 'verifier', 'support', 'finance', 'analyst'))
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"push_token" text,
	"app_version" text,
	"last_seen_at" timestamp with time zone,
	"notifications_enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "devices_platform_check" CHECK ("devices"."platform" in ('android', 'ios', 'web'))
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"device_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"name" text,
	"language" text DEFAULT 'sw' NOT NULL,
	"roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"consent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_phone_unique" UNIQUE("phone"),
	CONSTRAINT "users_phone_check" CHECK ("users"."phone" ~ '^254[17][0-9]{8}$'),
	CONSTRAINT "users_language_check" CHECK ("users"."language" in ('sw', 'en')),
	CONSTRAINT "users_roles_check" CHECK ("users"."roles" <@ array['farmer', 'vet', 'admin']::text[])
);
--> statement-breakpoint
CREATE TABLE "farmers" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"ward_id" integer,
	"farm_lat" double precision,
	"farm_lng" double precision,
	"farm_notes" text
);
--> statement-breakpoint
CREATE TABLE "vet_applications" (
	"id" serial PRIMARY KEY NOT NULL,
	"vet_user_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"reference" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_via" text DEFAULT 'self' NOT NULL,
	"created_by" uuid,
	"current_step" integer DEFAULT 1 NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone,
	"claimed_by" uuid,
	"claimed_at" timestamp with time zone,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reasons" text[],
	"decision_note" text,
	"internal_note" text,
	"flagged_fields" jsonb,
	"checklist" jsonb,
	CONSTRAINT "vet_applications_reference_unique" UNIQUE("reference"),
	CONSTRAINT "vet_applications_vet_user_id_version_key" UNIQUE("vet_user_id","version"),
	CONSTRAINT "vet_applications_status_check" CHECK ("vet_applications"."status" in ('draft', 'submitted', 'under_review', 'changes_requested', 'approved', 'rejected', 'withdrawn')),
	CONSTRAINT "vet_applications_created_via_check" CHECK ("vet_applications"."created_via" in ('self', 'admin_assisted'))
);
--> statement-breakpoint
CREATE TABLE "vet_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"vet_user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"storage_key" text NOT NULL,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"flag_reason" text,
	"expires_at" date,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "vet_documents_status_check" CHECK ("vet_documents"."status" in ('uploaded', 'accepted', 'flagged'))
);
--> statement-breakpoint
CREATE TABLE "vets" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"kvb_reg_no" text,
	"kvb_category" text,
	"licence_expiry" date,
	"national_id_enc" text,
	"national_id_hash" text,
	"qualification" text,
	"qualification_institution" text,
	"qualification_year" integer,
	"practice_type" text,
	"practice_name" text,
	"years_experience" integer,
	"services" text[] DEFAULT '{}'::text[] NOT NULL,
	"languages" text[] DEFAULT '{}'::text[] NOT NULL,
	"bio" text,
	"payout_mpesa_phone" text,
	"verification_status" text DEFAULT 'draft' NOT NULL,
	"verified_at" timestamp with time zone,
	"specialties" text[] DEFAULT '{}'::text[] NOT NULL,
	"ward_id" integer,
	"service_radius_km" integer DEFAULT 20 NOT NULL,
	"base_call_out_fee" integer,
	"rating" numeric(2, 1),
	"is_available" boolean DEFAULT false NOT NULL,
	"share_live_location" boolean DEFAULT false NOT NULL,
	"live_lat" double precision,
	"live_lng" double precision,
	"live_location_at" timestamp with time zone,
	CONSTRAINT "vets_type_check" CHECK ("vets"."type" in ('vet', 'paravet')),
	CONSTRAINT "vets_practice_type_check" CHECK ("vets"."practice_type" in ('independent', 'clinic', 'agrovet')),
	CONSTRAINT "vets_verification_status_check" CHECK ("vets"."verification_status" in ('draft', 'submitted', 'under_review', 'changes_requested', 'approved', 'rejected', 'suspended'))
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"county" text NOT NULL,
	"sub_county" text NOT NULL,
	"ward" text NOT NULL,
	"lat" double precision,
	"lng" double precision,
	CONSTRAINT "locations_county_sub_county_ward_key" UNIQUE("county","sub_county","ward")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"push_sent_at" timestamp with time zone,
	"sms_sent_at" timestamp with time zone,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ussd_sessions" (
	"session_id" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"state" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "animals" ADD CONSTRAINT "animals_farmer_id_farmers_user_id_fk" FOREIGN KEY ("farmer_id") REFERENCES "public"."farmers"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_offers" ADD CONSTRAINT "booking_offers_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_offers" ADD CONSTRAINT "booking_offers_vet_id_vets_user_id_fk" FOREIGN KEY ("vet_id") REFERENCES "public"."vets"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_farmer_id_farmers_user_id_fk" FOREIGN KEY ("farmer_id") REFERENCES "public"."farmers"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_vet_id_vets_user_id_fk" FOREIGN KEY ("vet_id") REFERENCES "public"."vets"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_animal_id_animals_id_fk" FOREIGN KEY ("animal_id") REFERENCES "public"."animals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_ward_id_locations_id_fk" FOREIGN KEY ("ward_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_animal_id_animals_id_fk" FOREIGN KEY ("animal_id") REFERENCES "public"."animals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_animal_id_animals_id_fk" FOREIGN KEY ("animal_id") REFERENCES "public"."animals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatments" ADD CONSTRAINT "treatments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatments" ADD CONSTRAINT "treatments_animal_id_animals_id_fk" FOREIGN KEY ("animal_id") REFERENCES "public"."animals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_profiles" ADD CONSTRAINT "admin_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_profiles" ADD CONSTRAINT "admin_profiles_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "farmers" ADD CONSTRAINT "farmers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "farmers" ADD CONSTRAINT "farmers_ward_id_locations_id_fk" FOREIGN KEY ("ward_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vet_applications" ADD CONSTRAINT "vet_applications_vet_user_id_vets_user_id_fk" FOREIGN KEY ("vet_user_id") REFERENCES "public"."vets"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vet_applications" ADD CONSTRAINT "vet_applications_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vet_applications" ADD CONSTRAINT "vet_applications_claimed_by_users_id_fk" FOREIGN KEY ("claimed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vet_applications" ADD CONSTRAINT "vet_applications_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vet_documents" ADD CONSTRAINT "vet_documents_application_id_vet_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."vet_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vet_documents" ADD CONSTRAINT "vet_documents_vet_user_id_vets_user_id_fk" FOREIGN KEY ("vet_user_id") REFERENCES "public"."vets"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vet_documents" ADD CONSTRAINT "vet_documents_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vets" ADD CONSTRAINT "vets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vets" ADD CONSTRAINT "vets_ward_id_locations_id_fk" FOREIGN KEY ("ward_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "animals_farmer_id_idx" ON "animals" USING btree ("farmer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_offers_booking_id_vet_id_key" ON "booking_offers" USING btree ("booking_id","vet_id");--> statement-breakpoint
CREATE INDEX "booking_offers_vet_id_idx" ON "booking_offers" USING btree ("vet_id");--> statement-breakpoint
CREATE INDEX "bookings_status_created_at_idx" ON "bookings" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "bookings_farmer_id_idx" ON "bookings" USING btree ("farmer_id");--> statement-breakpoint
CREATE INDEX "bookings_vet_id_idx" ON "bookings" USING btree ("vet_id");--> statement-breakpoint
CREATE INDEX "reminders_due_date_unsent_idx" ON "reminders" USING btree ("due_date") WHERE "reminders"."sent_at" is null;--> statement-breakpoint
CREATE INDEX "treatments_diagnosis_code_created_at_idx" ON "treatments" USING btree ("diagnosis_code","created_at");--> statement-breakpoint
CREATE INDEX "devices_user_id_idx" ON "devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "otp_codes_phone_expires_at_idx" ON "otp_codes" USING btree ("phone","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "vet_documents_application_id_idx" ON "vet_documents" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "vets_ward_id_approved_available_idx" ON "vets" USING btree ("ward_id") WHERE "vets"."verification_status" = 'approved' and "vets"."is_available";--> statement-breakpoint
CREATE INDEX "notifications_user_id_idx" ON "notifications" USING btree ("user_id");