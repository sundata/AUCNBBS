CREATE TABLE "page_views" (
    "id" BIGSERIAL NOT NULL,
    "path" VARCHAR(200) NOT NULL,
    "referrer" VARCHAR(300),
    "visitor_key" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_views_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "page_views_created_at_idx" ON "page_views"("created_at");
CREATE INDEX "page_views_visitor_key_created_at_idx" ON "page_views"("visitor_key", "created_at");
