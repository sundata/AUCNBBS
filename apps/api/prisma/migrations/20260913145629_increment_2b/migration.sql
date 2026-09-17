-- DropForeignKey
ALTER TABLE "weekend_saves" DROP CONSTRAINT "weekend_saves_event_id_fkey";

-- DropForeignKey
ALTER TABLE "weekend_saves" DROP CONSTRAINT "weekend_saves_user_id_fkey";

-- AlterTable
ALTER TABLE "listings" ADD COLUMN     "review_note" TEXT,
ADD COLUMN     "reviewed_by_id" UUID;

-- AddForeignKey
ALTER TABLE "weekend_saves" ADD CONSTRAINT "weekend_saves_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "weekend_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
