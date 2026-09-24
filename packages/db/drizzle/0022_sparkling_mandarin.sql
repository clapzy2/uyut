CREATE TABLE "concept_plan_reviews" (
	"concept_id" uuid PRIMARY KEY NOT NULL,
	"review" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "concept_plan_reviews" ADD CONSTRAINT "concept_plan_reviews_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;