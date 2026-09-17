/*
  Warnings:

  - A unique constraint covering the columns `[checkin_code]` on the table `event_rsvps` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[accepted_comment_id]` on the table `posts` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'past_due', 'canceled');

-- AlterEnum
ALTER TYPE "PostType" ADD VALUE 'poll';

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_listing_id_fkey";

-- AlterTable
ALTER TABLE "articles" ADD COLUMN     "collection" TEXT,
ADD COLUMN     "publish_at" TIMESTAMP(3),
ADD COLUMN     "source_url" TEXT;

-- AlterTable
ALTER TABLE "business_reviews" ADD COLUMN     "rating_quality" INTEGER,
ADD COLUMN     "rating_service" INTEGER,
ADD COLUMN     "rating_value" INTEGER;

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active';

-- AlterTable
ALTER TABLE "event_rsvps" ADD COLUMN     "checked_in_at" TIMESTAMP(3),
ADD COLUMN     "checkin_code" TEXT;

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "recurrence" TEXT,
ADD COLUMN     "reminder_sent_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "listings" ADD COLUMN     "contact_phone" TEXT,
ADD COLUMN     "lat" DOUBLE PRECISION,
ADD COLUMN     "lng" DOUBLE PRECISION,
ADD COLUMN     "risk_flags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "has_link" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "masked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "recalled_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "data" JSONB;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "ad_campaign_id" UUID,
ADD COLUMN     "business_id" UUID,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'promotion',
ALTER COLUMN "listing_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "accepted_comment_id" UUID,
ADD COLUMN     "locked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "slowmode_sec" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "ip_hash" TEXT,
ADD COLUMN     "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "birth_year" INTEGER,
ADD COLUMN     "marketing_opt_out_at" TIMESTAMP(3),
ADD COLUMN     "muted_until" TIMESTAMP(3),
ADD COLUMN     "notification_prefs" JSONB,
ADD COLUMN     "personalization_off" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "totp_enabled_at" TIMESTAMP(3),
ADD COLUMN     "totp_secret" TEXT;

-- CreateTable
CREATE TABLE "consent_records" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_blocks" (
    "id" UUID NOT NULL,
    "blocker_id" UUID NOT NULL,
    "blocked_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mfa_challenges" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "polls" (
    "id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "multi" BOOLEAN NOT NULL DEFAULT false,
    "closes_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "polls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poll_options" (
    "id" UUID NOT NULL,
    "poll_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "poll_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poll_votes" (
    "id" UUID NOT NULL,
    "option_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "poll_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_revisions" (
    "id" UUID NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "editor_id" UUID,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "business_id" UUID,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'active',
    "stripe_subscription_id" TEXT,
    "credits" INTEGER NOT NULL DEFAULT 0,
    "current_period_end" TIMESTAMP(3),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'aud',
    "status" TEXT NOT NULL DEFAULT 'paid',
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_campaigns" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "target_url" TEXT NOT NULL,
    "image_url" TEXT,
    "city_id" UUID,
    "placement" TEXT NOT NULL DEFAULT 'home',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "budget_minor" INTEGER NOT NULL,
    "spent_minor" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_locations" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "suburb" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "opening_hours" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_members" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'staff',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_leads" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "from_user_id" UUID,
    "name" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'web',
    "status" TEXT NOT NULL DEFAULT 'new',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_config" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_config_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "throttle_buckets" (
    "key" TEXT NOT NULL,
    "hits" JSONB NOT NULL DEFAULT '[]',
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "throttle_buckets_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "consent_records_user_id_kind_created_at_idx" ON "consent_records"("user_id", "kind", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_blocks_blocker_id_blocked_id_key" ON "user_blocks"("blocker_id", "blocked_id");

-- CreateIndex
CREATE UNIQUE INDEX "mfa_challenges_token_key" ON "mfa_challenges"("token");

-- CreateIndex
CREATE UNIQUE INDEX "polls_post_id_key" ON "polls"("post_id");

-- CreateIndex
CREATE INDEX "poll_options_poll_id_position_idx" ON "poll_options"("poll_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "poll_votes_option_id_user_id_key" ON "poll_votes"("option_id", "user_id");

-- CreateIndex
CREATE INDEX "content_revisions_subject_type_subject_id_created_at_idx" ON "content_revisions"("subject_type", "subject_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripe_subscription_id_key" ON "subscriptions"("stripe_subscription_id");

-- CreateIndex
CREATE INDEX "subscriptions_owner_id_status_idx" ON "subscriptions"("owner_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_payment_id_key" ON "invoices"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");

-- CreateIndex
CREATE INDEX "invoices_owner_id_issued_at_idx" ON "invoices"("owner_id", "issued_at");

-- CreateIndex
CREATE INDEX "ad_campaigns_status_placement_starts_at_idx" ON "ad_campaigns"("status", "placement", "starts_at");

-- CreateIndex
CREATE INDEX "business_locations_business_id_idx" ON "business_locations"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "business_members_business_id_user_id_key" ON "business_members"("business_id", "user_id");

-- CreateIndex
CREATE INDEX "business_leads_business_id_status_created_at_idx" ON "business_leads"("business_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "offers_business_id_status_ends_at_idx" ON "offers"("business_id", "status", "ends_at");

-- CreateIndex
CREATE INDEX "throttle_buckets_expires_at_idx" ON "throttle_buckets"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "event_rsvps_checkin_code_key" ON "event_rsvps"("checkin_code");

-- CreateIndex
CREATE UNIQUE INDEX "posts_accepted_comment_id_key" ON "posts"("accepted_comment_id");

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_challenges" ADD CONSTRAINT "mfa_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_accepted_comment_id_fkey" FOREIGN KEY ("accepted_comment_id") REFERENCES "comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "polls" ADD CONSTRAINT "polls_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_options" ADD CONSTRAINT "poll_options_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "polls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "poll_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_revisions" ADD CONSTRAINT "content_revisions_editor_id_fkey" FOREIGN KEY ("editor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_ad_campaign_id_fkey" FOREIGN KEY ("ad_campaign_id") REFERENCES "ad_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_locations" ADD CONSTRAINT "business_locations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_members" ADD CONSTRAINT "business_members_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_members" ADD CONSTRAINT "business_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_leads" ADD CONSTRAINT "business_leads_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_leads" ADD CONSTRAINT "business_leads_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
