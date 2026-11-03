-- Ad-platform connections: public pixel/tag ids in Settings, an ADS consent channel, and a log of server-side conversion events.
-- AlterEnum
ALTER TYPE "ConsentChannel" ADD VALUE 'ADS';

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "googleLeadSendTo" TEXT,
ADD COLUMN     "googleSignupSendTo" TEXT,
ADD COLUMN     "googleTagId" TEXT,
ADD COLUMN     "metaPixelId" TEXT,
ADD COLUMN     "tiktokPixelId" TEXT;

-- CreateTable
CREATE TABLE "AdEventLog" (
    "id" TEXT NOT NULL,
    "personId" TEXT,
    "platform" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "status" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdEventLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdEventLog_createdAt_idx" ON "AdEventLog"("createdAt");

-- CreateIndex
CREATE INDEX "AdEventLog_platform_createdAt_idx" ON "AdEventLog"("platform", "createdAt");

-- CreateIndex
CREATE INDEX "AdEventLog_personId_idx" ON "AdEventLog"("personId");

-- AddForeignKey
ALTER TABLE "AdEventLog" ADD CONSTRAINT "AdEventLog_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

