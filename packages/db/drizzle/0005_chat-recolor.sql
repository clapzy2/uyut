CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "concept_objects" ADD COLUMN "swatch_id" text;--> statement-breakpoint
ALTER TABLE "concept_objects" ADD COLUMN "edited_embedding" vector(1024);--> statement-breakpoint
ALTER TABLE "concepts" ADD COLUMN "edited_render_url" text;--> statement-breakpoint
ALTER TABLE "concepts" ADD COLUMN "edits" jsonb;--> statement-breakpoint
ALTER TABLE "concepts" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_messages_project_idx" ON "chat_messages" USING btree ("project_id","created_at");