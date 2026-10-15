ALTER TABLE "payments" ADD COLUMN "merchant_request_id" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "result_code" integer;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "result_desc" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "refund_of" integer;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_refund_of_payments_id_fk" FOREIGN KEY ("refund_of") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_one_pending_deposit_key" ON "payments" USING btree ("booking_id") WHERE "payments"."type" = 'deposit' and "payments"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "payments_one_paid_deposit_key" ON "payments" USING btree ("booking_id") WHERE "payments"."type" = 'deposit' and "payments"."status" in ('success', 'refunded');--> statement-breakpoint
CREATE INDEX "payments_status_created_at_idx" ON "payments" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_refund_of_unique" UNIQUE("refund_of");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_refund_of_check" CHECK (("payments"."type" = 'refund') = ("payments"."refund_of" is not null));