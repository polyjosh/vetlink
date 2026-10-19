ALTER TABLE "bookings" ADD COLUMN "scheduled_for" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "scheduled_part" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "reminder_evening_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "reminder_hour_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "overdue_flagged_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "bookings_scheduled_for_idx" ON "bookings" USING btree ("scheduled_for") WHERE "bookings"."scheduled_for" is not null;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_scheduled_part_check" CHECK ("bookings"."scheduled_part" in ('morning', 'afternoon', 'evening'));--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_scheduled_both_check" CHECK (("bookings"."scheduled_for" is null) = ("bookings"."scheduled_part" is null));