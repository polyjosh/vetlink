ALTER TABLE "ratings" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "treatments" ADD COLUMN "follow_up_booking_id" integer;--> statement-breakpoint
ALTER TABLE "treatments" ADD COLUMN "vet_alert_evening_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "treatments" ADD COLUMN "vet_alert_day_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vets" ADD COLUMN "badges" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "vets" ADD COLUMN "review_flag_reason" text;--> statement-breakpoint
ALTER TABLE "vets" ADD COLUMN "review_flagged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "treatments" ADD CONSTRAINT "treatments_follow_up_booking_id_bookings_id_fk" FOREIGN KEY ("follow_up_booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_tags_check" CHECK ("ratings"."tags" <@ array['on_time', 'explained_well', 'fair_price', 'gentle_with_animal', 'animal_recovered', 'would_book_again', 'late', 'unclear_price', 'rude']::text[]);--> statement-breakpoint
ALTER TABLE "vets" ADD CONSTRAINT "vets_badges_check" CHECK ("vets"."badges" <@ array['verified', 'top_rated', 'fast_responder', 'jobs_50', 'jobs_100', 'jobs_500', 'vaccinations_100']::text[]);--> statement-breakpoint
ALTER TABLE "vets" ADD CONSTRAINT "vets_review_flag_reason_check" CHECK ("vets"."review_flag_reason" in ('rude_rating', 'repeated_low_ratings'));