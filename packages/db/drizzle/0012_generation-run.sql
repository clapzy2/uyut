ALTER TABLE "rooms" ADD COLUMN "generation_run_id" text;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "generation_started_at" timestamp with time zone;