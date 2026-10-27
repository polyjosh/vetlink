CREATE TABLE "wallet_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"kind" text NOT NULL,
	"booking_id" integer,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_entries_kind_check" CHECK ("wallet_entries"."kind" in ('credit_no_vet', 'credit_cancelled', 'credit_late_payment', 'debit_booking_fee', 'adjustment', 'expired')),
	CONSTRAINT "wallet_entries_amount_check" CHECK ("wallet_entries"."amount" <> 0)
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "method" text DEFAULT 'mpesa' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "wallet_amount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_entries_booking_kind_key" ON "wallet_entries" USING btree ("booking_id","kind") WHERE "wallet_entries"."booking_id" is not null;--> statement-breakpoint
CREATE INDEX "wallet_entries_user_idx" ON "wallet_entries" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_method_check" CHECK ("payments"."method" in ('mpesa', 'wallet'));--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_wallet_amount_check" CHECK ("payments"."wallet_amount" >= 0 and "payments"."wallet_amount" <= "payments"."amount");