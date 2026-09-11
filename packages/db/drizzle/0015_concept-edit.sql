-- Правка выбранного рендера: откуда отталкивались и о чём просили. Без этого нельзя
-- отличить правку от обычной генерации и показать человеку, что именно он просил поменять.
ALTER TABLE "concepts" ADD COLUMN "base_concept_id" uuid;--> statement-breakpoint
ALTER TABLE "concepts" ADD COLUMN "edit_request" text;