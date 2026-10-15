CREATE TABLE "booking_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"booking_id" integer NOT NULL,
	"event" text NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_user_id" uuid,
	"channel" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_events_event_check" CHECK ("booking_events"."event" in ('deposit_confirmed', 'payment_failed', 'vet_accepted', 'vet_released', 'vet_en_route', 'vet_arrived', 'vet_completed', 'farmer_cancelled', 'no_vet_found', 'admin_cancelled')),
	CONSTRAINT "booking_events_from_status_check" CHECK ("booking_events"."from_status" in ('pending_payment', 'pending', 'matched', 'en_route', 'in_service', 'done', 'cancelled', 'expired')),
	CONSTRAINT "booking_events_to_status_check" CHECK ("booking_events"."to_status" in ('pending_payment', 'pending', 'matched', 'en_route', 'in_service', 'done', 'cancelled', 'expired')),
	CONSTRAINT "booking_events_actor_kind_check" CHECK ("booking_events"."actor_kind" in ('farmer', 'vet', 'admin', 'system')),
	CONSTRAINT "booking_events_channel_check" CHECK ("booking_events"."channel" in ('ussd', 'sms', 'app', 'web', 'admin'))
);
--> statement-breakpoint
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_events_booking_id_idx" ON "booking_events" USING btree ("booking_id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_species_check" CHECK ("bookings"."species" in ('cattle', 'goat', 'sheep', 'pig', 'poultry', 'dog', 'other'));--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_problem_type_check" CHECK ("bookings"."problem_type" in ('sick', 'injury', 'breeding', 'vaccination', 'other'));