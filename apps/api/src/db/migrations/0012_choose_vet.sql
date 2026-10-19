ALTER TABLE "booking_events" DROP CONSTRAINT "booking_events_event_check";--> statement-breakpoint
ALTER TABLE "booking_events" DROP CONSTRAINT "booking_events_from_status_check";--> statement-breakpoint
ALTER TABLE "booking_events" DROP CONSTRAINT "booking_events_to_status_check";--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_status_check";--> statement-breakpoint
ALTER TABLE "booking_offers" ADD COLUMN "kind" text DEFAULT 'wave' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "dispatch_mode" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "requested_vet_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "status_deadline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_requested_vet_id_vets_user_id_fk" FOREIGN KEY ("requested_vet_id") REFERENCES "public"."vets"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_status_deadline_idx" ON "bookings" USING btree ("status_deadline_at") WHERE "bookings"."status_deadline_at" is not null;--> statement-breakpoint
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_event_check" CHECK ("booking_events"."event" in ('deposit_confirmed', 'payment_failed', 'vet_accepted', 'vet_released', 'vet_en_route', 'vet_arrived', 'vet_completed', 'farmer_cancelled', 'no_vet_found', 'admin_cancelled', 'vet_declined_request', 'request_timed_out', 'farmer_rechose', 'farmer_switched_to_auto', 'deposit_timed_out', 'request_abandoned'));--> statement-breakpoint
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_from_status_check" CHECK ("booking_events"."from_status" in ('pending_payment', 'pending', 'matched', 'en_route', 'in_service', 'done', 'cancelled', 'expired', 'requested', 'vet_unavailable', 'awaiting_deposit'));--> statement-breakpoint
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_to_status_check" CHECK ("booking_events"."to_status" in ('pending_payment', 'pending', 'matched', 'en_route', 'in_service', 'done', 'cancelled', 'expired', 'requested', 'vet_unavailable', 'awaiting_deposit'));--> statement-breakpoint
ALTER TABLE "booking_offers" ADD CONSTRAINT "booking_offers_kind_check" CHECK ("booking_offers"."kind" in ('wave', 'direct'));--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_dispatch_mode_check" CHECK ("bookings"."dispatch_mode" in ('auto', 'chosen'));--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_status_check" CHECK ("bookings"."status" in ('pending_payment', 'pending', 'matched', 'en_route', 'in_service', 'done', 'cancelled', 'expired', 'requested', 'vet_unavailable', 'awaiting_deposit'));