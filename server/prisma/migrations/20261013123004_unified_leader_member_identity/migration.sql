-- CreateEnum
CREATE TYPE "FriendshipOrigin" AS ENUM ('ORGANIC', 'REFERRAL');

-- AlterTable
ALTER TABLE "Announcement" ADD COLUMN     "authorPersonId" TEXT;

-- AlterTable
ALTER TABLE "Friendship" ADD COLUMN     "origin" "FriendshipOrigin" NOT NULL DEFAULT 'ORGANIC';

-- AlterTable
ALTER TABLE "HeadquartersPost" ADD COLUMN     "authorPersonId" TEXT;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "defaultReferrerPersonId" TEXT,
ADD COLUMN     "liveAuthorPersonId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "personLinkNotifiedAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_liveAuthorPersonId_fkey" FOREIGN KEY ("liveAuthorPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_defaultReferrerPersonId_fkey" FOREIGN KEY ("defaultReferrerPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_authorPersonId_fkey" FOREIGN KEY ("authorPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeadquartersPost" ADD CONSTRAINT "HeadquartersPost_authorPersonId_fkey" FOREIGN KEY ("authorPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

