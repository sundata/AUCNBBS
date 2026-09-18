-- AlterTable
ALTER TABLE "feed_items" ADD COLUMN     "summary_zh" TEXT,
ADD COLUMN     "title_hash" TEXT,
ADD COLUMN     "title_zh" TEXT;

-- CreateIndex
CREATE INDEX "feed_items_title_hash_idx" ON "feed_items"("title_hash");
