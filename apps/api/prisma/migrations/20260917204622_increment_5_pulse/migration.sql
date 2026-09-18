-- AlterTable
ALTER TABLE "weekend_events" ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'general',
ADD COLUMN     "city_id" UUID;

-- AlterTable
ALTER TABLE "weekend_sources" ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'general',
ADD COLUMN     "city_id" UUID;

-- CreateTable
CREATE TABLE "feed_sources" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "city_id" UUID,
    "auto_publish" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "interval_minutes" INTEGER NOT NULL DEFAULT 360,
    "next_run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_until" TIMESTAMP(3),
    "last_run_at" TIMESTAMP(3),
    "last_success_at" TIMESTAMP(3),
    "last_error" TEXT,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "last_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "feed_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed_items" (
    "id" UUID NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "source_id" TEXT,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "image_url" TEXT,
    "source_name" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "city_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "risk_flags" TEXT[],
    "published_at" TIMESTAMP(3),
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feed_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pulse_metrics" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "city_id" UUID,
    "payload" JSONB NOT NULL,
    "observed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pulse_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "feed_items_fingerprint_key" ON "feed_items"("fingerprint");

-- CreateIndex
CREATE INDEX "feed_items_status_category_published_at_idx" ON "feed_items"("status", "category", "published_at" DESC);

-- CreateIndex
CREATE INDEX "pulse_metrics_kind_city_id_observed_at_idx" ON "pulse_metrics"("kind", "city_id", "observed_at" DESC);

-- AddForeignKey
ALTER TABLE "feed_items" ADD CONSTRAINT "feed_items_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "feed_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
