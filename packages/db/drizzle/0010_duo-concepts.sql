ALTER TABLE "concepts" ADD COLUMN "batch_kind" text DEFAULT 'regular' NOT NULL;--> statement-breakpoint
ALTER TABLE "concepts" ADD COLUMN "title" text;