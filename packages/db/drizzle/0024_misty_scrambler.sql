ALTER TABLE "concepts" ADD COLUMN "source_photo_revision" integer;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "photo_revision" integer DEFAULT 0 NOT NULL;