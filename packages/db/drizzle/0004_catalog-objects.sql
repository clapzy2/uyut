CREATE TABLE "catalog_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"category" text NOT NULL,
	"subcategory" text,
	"brand" text,
	"title" text NOT NULL,
	"description" text,
	"price_kopecks" bigint NOT NULL,
	"old_price_kopecks" bigint,
	"currency" text DEFAULT 'RUB' NOT NULL,
	"affiliate_url" text NOT NULL,
	"images" jsonb NOT NULL,
	"attributes" jsonb,
	"variants" jsonb,
	"in_stock" boolean DEFAULT true NOT NULL,
	"image_embedding" vector(1024),
	"text_embedding" vector(1024),
	"content_hash" text NOT NULL,
	"embedded_hash" text,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "concept_objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"concept_id" uuid NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"category" text NOT NULL,
	"label" text NOT NULL,
	"bbox" jsonb NOT NULL,
	"mask_url" text,
	"embedding" vector(1024) NOT NULL,
	"matched_catalog_item_id" uuid,
	"matched_confidence" numeric(3, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "concepts" ADD COLUMN "objects_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "concepts" ADD COLUMN "objects_error" text;--> statement-breakpoint
ALTER TABLE "concept_objects" ADD CONSTRAINT "concept_objects_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_objects" ADD CONSTRAINT "concept_objects_matched_catalog_item_id_catalog_items_id_fk" FOREIGN KEY ("matched_catalog_item_id") REFERENCES "public"."catalog_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_items_source_external_idx" ON "catalog_items" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "catalog_items_category_idx" ON "catalog_items" USING btree ("category") WHERE "catalog_items"."in_stock" = true;--> statement-breakpoint
CREATE INDEX "catalog_items_price_idx" ON "catalog_items" USING btree ("price_kopecks") WHERE "catalog_items"."in_stock" = true;--> statement-breakpoint
CREATE INDEX "catalog_items_image_emb_idx" ON "catalog_items" USING ivfflat ("image_embedding" vector_cosine_ops) WITH (lists=50);--> statement-breakpoint
CREATE INDEX "concept_objects_concept_idx" ON "concept_objects" USING btree ("concept_id");--> statement-breakpoint
CREATE INDEX "concept_objects_embedding_idx" ON "concept_objects" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists=50);