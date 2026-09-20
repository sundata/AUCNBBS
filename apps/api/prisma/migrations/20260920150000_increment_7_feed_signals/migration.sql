-- AlterTable
ALTER TABLE "feed_items" ADD COLUMN     "location" TEXT,
ADD COLUMN     "price_cents" INTEGER,
ADD COLUMN     "price_period" TEXT;

-- CreateIndex
CREATE INDEX "feed_items_category_price_idx" ON "feed_items"("category", "price_period", "price_cents");

