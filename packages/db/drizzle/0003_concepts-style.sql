CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "concepts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_text" text,
	"render_url" text,
	"render_thumb_url" text,
	"prompt" text NOT NULL,
	"style_tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"ai_model" text NOT NULL,
	"seed" bigint,
	"liked_by_owner" boolean,
	"liked_by_partner" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "style_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"style_id" text NOT NULL,
	"liked" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "style_reference_embedding" vector(1024);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "reference_url" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "onboarded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "condition" text DEFAULT 'bare' NOT NULL;--> statement-breakpoint
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_votes" ADD CONSTRAINT "style_votes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "concepts_room_idx" ON "concepts" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "concepts_batch_idx" ON "concepts" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "style_votes_project_idx" ON "style_votes" USING btree ("project_id","style_id");