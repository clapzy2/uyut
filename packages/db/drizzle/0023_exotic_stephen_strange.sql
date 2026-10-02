ALTER TABLE "rooms" ADD COLUMN "space_kind" text DEFAULT 'interior' NOT NULL;
--> statement-breakpoint
UPDATE "rooms" SET "space_kind" = 'balcony' WHERE "name" ~* '^балкон([[:space:]]|[0-9]|$)';
--> statement-breakpoint
UPDATE "rooms" SET "space_kind" = 'loggia' WHERE "name" ~* '^лоджия([[:space:]]|[0-9]|$)';
