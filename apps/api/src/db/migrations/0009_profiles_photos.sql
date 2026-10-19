ALTER TABLE "media" DROP CONSTRAINT "media_kind_check";--> statement-breakpoint
ALTER TABLE "animals" ADD COLUMN "photo_media_id" uuid;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "content_type" text;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "size_bytes" integer;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "review_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "review_reason" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_media_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "theme" text DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "vets" ADD COLUMN "pending_avatar_media_id" uuid;--> statement-breakpoint
ALTER TABLE "animals" ADD CONSTRAINT "animals_photo_media_id_media_id_fk" FOREIGN KEY ("photo_media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_media_id_media_id_fk" FOREIGN KEY ("avatar_media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vets" ADD CONSTRAINT "vets_pending_avatar_media_id_media_id_fk" FOREIGN KEY ("pending_avatar_media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "media_storage_key_key" ON "media" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "media_owner_kind_idx" ON "media" USING btree ("owner_user_id","kind");--> statement-breakpoint
CREATE INDEX "media_pending_review_idx" ON "media" USING btree ("created_at") WHERE "media"."review_status" = 'pending';--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_review_status_check" CHECK ("media"."review_status" in ('none', 'pending', 'approved', 'rejected'));--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_review_reason_check" CHECK ("media"."review_reason" in ('face_not_clear', 'not_same_person', 'inappropriate', 'other'));--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_kind_check" CHECK ("media"."kind" in ('animal_photo', 'booking_photo', 'treatment_photo', 'avatar', 'booking_voice'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_theme_check" CHECK ("users"."theme" in ('system', 'light', 'dark'));