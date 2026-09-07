ALTER TABLE "purchases" ADD COLUMN "kind" text DEFAULT 'project' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "reminded_at" timestamp with time zone;