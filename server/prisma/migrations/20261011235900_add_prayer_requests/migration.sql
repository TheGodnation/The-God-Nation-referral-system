-- CreateEnum
CREATE TYPE "PrayerRequestVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'PRAYER_REQUEST_COMMENT';
ALTER TYPE "NotificationType" ADD VALUE 'PRAYER_REQUEST_SUBMITTED_PRIVATELY';

-- CreateTable
CREATE TABLE "PrayerRequest" (
    "id" TEXT NOT NULL,
    "authorPersonId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "visibility" "PrayerRequestVisibility" NOT NULL DEFAULT 'PUBLIC',
    "communityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedByPersonId" TEXT,
    "deletedByUserId" TEXT,

    CONSTRAINT "PrayerRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrayerRequestComment" (
    "id" TEXT NOT NULL,
    "prayerRequestId" TEXT NOT NULL,
    "authorPersonId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "deletedByPersonId" TEXT,
    "deletedByUserId" TEXT,

    CONSTRAINT "PrayerRequestComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PrayerRequest_visibility_createdAt_idx" ON "PrayerRequest"("visibility", "createdAt");

-- CreateIndex
CREATE INDEX "PrayerRequest_communityId_idx" ON "PrayerRequest"("communityId");

-- CreateIndex
CREATE INDEX "PrayerRequest_authorPersonId_idx" ON "PrayerRequest"("authorPersonId");

-- CreateIndex
CREATE INDEX "PrayerRequest_deletedAt_idx" ON "PrayerRequest"("deletedAt");

-- CreateIndex
CREATE INDEX "PrayerRequestComment_prayerRequestId_createdAt_idx" ON "PrayerRequestComment"("prayerRequestId", "createdAt");

-- AddForeignKey
ALTER TABLE "PrayerRequest" ADD CONSTRAINT "PrayerRequest_authorPersonId_fkey" FOREIGN KEY ("authorPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrayerRequest" ADD CONSTRAINT "PrayerRequest_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrayerRequest" ADD CONSTRAINT "PrayerRequest_deletedByPersonId_fkey" FOREIGN KEY ("deletedByPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrayerRequest" ADD CONSTRAINT "PrayerRequest_deletedByUserId_fkey" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrayerRequestComment" ADD CONSTRAINT "PrayerRequestComment_prayerRequestId_fkey" FOREIGN KEY ("prayerRequestId") REFERENCES "PrayerRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrayerRequestComment" ADD CONSTRAINT "PrayerRequestComment_authorPersonId_fkey" FOREIGN KEY ("authorPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrayerRequestComment" ADD CONSTRAINT "PrayerRequestComment_deletedByPersonId_fkey" FOREIGN KEY ("deletedByPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrayerRequestComment" ADD CONSTRAINT "PrayerRequestComment_deletedByUserId_fkey" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

