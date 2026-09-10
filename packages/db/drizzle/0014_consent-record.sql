-- Отметка о согласии на обработку данных: закон возлагает на оператора обязанность
-- доказать, что согласие было. Галочка при регистрации жила только в браузере.
ALTER TABLE "users" ADD COLUMN "consent_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "consent_version" text;