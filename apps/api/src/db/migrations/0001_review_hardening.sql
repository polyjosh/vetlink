ALTER TABLE "users" DROP CONSTRAINT "users_phone_unique";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_phone_check";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_roles_check";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "phone" DROP NOT NULL;--> statement-breakpoint
-- Data steps (hand-added) so the new CHECKs below hold on existing rows.
-- Admin access now comes only from admin_profiles, never from users.roles.
UPDATE "users" SET "roles" = array_remove("roles", 'admin') WHERE 'admin' = ANY("roles");--> statement-breakpoint
-- Invariant 2: no unapproved vet may be online.
UPDATE "vets" SET "is_available" = false WHERE "is_available" AND "verification_status" <> 'approved';--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_active_key" ON "users" USING btree ("phone") WHERE "users"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "vets_national_id_hash_idx" ON "vets" USING btree ("national_id_hash");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_fee_quoted_check" CHECK ("bookings"."fee_quoted" >= 0);--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_kind_check" CHECK ("media"."kind" in ('animal_photo', 'booking_photo', 'treatment_photo'));--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_check" CHECK ("payments"."amount" > 0);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_phone_check" CHECK (("users"."phone" is null and "users"."deleted_at" is not null) or coalesce("users"."phone" ~ '^254[17][0-9]{8}$', false));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_roles_check" CHECK ("users"."roles" <@ array['farmer', 'vet']::text[]);--> statement-breakpoint
ALTER TABLE "vet_documents" ADD CONSTRAINT "vet_documents_kind_check" CHECK ("vet_documents"."kind" in ('id_front', 'id_back', 'certificate', 'licence', 'profile_photo', 'training_cert'));--> statement-breakpoint
ALTER TABLE "vets" ADD CONSTRAINT "vets_available_requires_approved" CHECK (not "vets"."is_available" or "vets"."verification_status" = 'approved');--> statement-breakpoint
ALTER TABLE "vets" ADD CONSTRAINT "vets_base_call_out_fee_check" CHECK ("vets"."base_call_out_fee" >= 0);--> statement-breakpoint
ALTER TABLE "vets" ADD CONSTRAINT "vets_rating_check" CHECK ("vets"."rating" between 1 and 5);