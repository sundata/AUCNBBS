CREATE TABLE "weekend_sources" (
 "id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "url" TEXT NOT NULL, "format" TEXT NOT NULL,
 "enabled" BOOLEAN NOT NULL DEFAULT false, "interval_minutes" INTEGER NOT NULL DEFAULT 360,
 "next_run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lease_until" TIMESTAMP(3),
 "last_run_at" TIMESTAMP(3), "last_success_at" TIMESTAMP(3), "last_error" TEXT,
 "failures" INTEGER NOT NULL DEFAULT 0, "last_count" INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE "weekend_events" (
 "id" UUID PRIMARY KEY, "fingerprint" TEXT NOT NULL UNIQUE, "source_id" TEXT,
 "source_name" TEXT NOT NULL, "source_url" TEXT NOT NULL, "title" TEXT NOT NULL,
 "summary" TEXT NOT NULL DEFAULT '', "suburb" TEXT NOT NULL DEFAULT '', "venue" TEXT NOT NULL DEFAULT '',
 "starts_at" TIMESTAMP(3), "ends_at" TIMESTAMP(3), "price_minor" INTEGER,
 "family" BOOLEAN, "indoor" BOOLEAN, "booking" TEXT NOT NULL DEFAULT 'unknown',
 "status" TEXT NOT NULL DEFAULT 'pending', "reviewed_at" TIMESTAMP(3),
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "weekend_events_status_starts_at_idx" ON "weekend_events"("status", "starts_at");
CREATE TABLE "weekend_saves" (
 "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
 "event_id" UUID NOT NULL REFERENCES "weekend_events"("id") ON DELETE CASCADE,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("user_id", "event_id")
);
