CREATE TABLE "sms_inbound" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"provider_message_id" text NOT NULL,
	"phone" text NOT NULL,
	"text" text NOT NULL,
	"user_id" uuid,
	"command" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sms_inbound" ADD CONSTRAINT "sms_inbound_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sms_inbound_provider_message_id_key" ON "sms_inbound" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX "sms_inbound_phone_idx" ON "sms_inbound" USING btree ("phone");