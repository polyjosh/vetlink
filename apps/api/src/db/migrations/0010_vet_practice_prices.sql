CREATE TABLE "vet_service_fees" (
	"vet_id" uuid NOT NULL,
	"service" text NOT NULL,
	"fee_from_kes" integer NOT NULL,
	CONSTRAINT "vet_service_fees_vet_id_service_pk" PRIMARY KEY("vet_id","service"),
	CONSTRAINT "vet_service_fees_service_check" CHECK ("vet_service_fees"."service" in ('treatment', 'vaccination', 'artificial_insemination', 'deworming', 'pregnancy_diagnosis', 'minor_surgery')),
	CONSTRAINT "vet_service_fees_fee_check" CHECK ("vet_service_fees"."fee_from_kes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "services" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "booking_fee_kes" integer DEFAULT 200 NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "price_range" jsonb;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "vet_price" jsonb;--> statement-breakpoint
ALTER TABLE "vets" ADD COLUMN "consultation_fee" integer;--> statement-breakpoint
ALTER TABLE "vets" ADD COLUMN "offers_call_outs" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "vets" ADD COLUMN "has_premises" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "vets" ADD COLUMN "premises_ward_id" integer;--> statement-breakpoint
ALTER TABLE "vets" ADD COLUMN "premises_lat" double precision;--> statement-breakpoint
ALTER TABLE "vets" ADD COLUMN "premises_lng" double precision;--> statement-breakpoint
ALTER TABLE "vets" ADD COLUMN "premises_directions" text;--> statement-breakpoint
ALTER TABLE "vets" ADD COLUMN "premises_hours" text;--> statement-breakpoint
ALTER TABLE "vets" ADD COLUMN "working_hours" jsonb;--> statement-breakpoint
ALTER TABLE "vet_service_fees" ADD CONSTRAINT "vet_service_fees_vet_id_vets_user_id_fk" FOREIGN KEY ("vet_id") REFERENCES "public"."vets"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vets" ADD CONSTRAINT "vets_premises_ward_id_locations_id_fk" FOREIGN KEY ("premises_ward_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_services_check" CHECK ("bookings"."services" <@ array['treatment', 'vaccination', 'artificial_insemination', 'deworming', 'pregnancy_diagnosis', 'minor_surgery']::text[]);--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_booking_fee_check" CHECK ("bookings"."booking_fee_kes" > 0);--> statement-breakpoint
ALTER TABLE "vets" ADD CONSTRAINT "vets_consultation_fee_check" CHECK ("vets"."consultation_fee" >= 0);--> statement-breakpoint
ALTER TABLE "vets" ADD CONSTRAINT "vets_call_outs_or_premises" CHECK ("vets"."offers_call_outs" or "vets"."has_premises");