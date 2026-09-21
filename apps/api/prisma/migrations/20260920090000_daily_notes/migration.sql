CREATE TABLE "daily_notes" (
 "id" UUID PRIMARY KEY,
 "delivery_id" TEXT NOT NULL UNIQUE,
 "digest" TEXT NOT NULL,
 "city" TEXT NOT NULL,
 "edition" TEXT NOT NULL,
 "title" TEXT NOT NULL,
 "summary" TEXT NOT NULL,
 "body" TEXT NOT NULL,
 "tags" TEXT[] NOT NULL,
 "sources" JSONB NOT NULL,
 "image_kind" TEXT NOT NULL,
 "image_credit" TEXT NOT NULL,
 "image_alt" TEXT NOT NULL,
 "cover" BYTEA NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'draft',
 "published_at" TIMESTAMP(3),
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "daily_notes_status_city_edition_idx" ON "daily_notes"("status", "city", "edition");
