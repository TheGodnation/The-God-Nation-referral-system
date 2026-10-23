-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "headquartersCommunityId" TEXT;

-- AddForeignKey
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_headquartersCommunityId_fkey" FOREIGN KEY ("headquartersCommunityId") REFERENCES "Community"("id") ON DELETE SET NULL ON UPDATE CASCADE;

