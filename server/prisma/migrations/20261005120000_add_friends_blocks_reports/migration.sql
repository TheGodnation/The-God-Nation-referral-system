-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'FRIEND_REQUEST_RECEIVED';
ALTER TYPE "NotificationType" ADD VALUE 'FRIEND_REQUEST_ACCEPTED';

-- CreateEnum
CREATE TYPE "FriendshipStatus" AS ENUM ('PENDING', 'ACCEPTED');
CREATE TYPE "FriendRequestPolicy" AS ENUM ('EVERYONE', 'SAME_GROUP');
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'RESOLVED');

-- AlterTable
ALTER TABLE "Person" ADD COLUMN "friendRequestPolicy" "FriendRequestPolicy" NOT NULL DEFAULT 'EVERYONE';

-- CreateTable
CREATE TABLE "Friendship" (
    "id" TEXT NOT NULL,
    "requesterPersonId" TEXT NOT NULL,
    "addresseePersonId" TEXT NOT NULL,
    "status" "FriendshipStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "Friendship_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PersonBlock" (
    "id" TEXT NOT NULL,
    "blockerPersonId" TEXT NOT NULL,
    "blockedPersonId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonBlock_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MemberReport" (
    "id" TEXT NOT NULL,
    "reporterPersonId" TEXT NOT NULL,
    "reportedPersonId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "reason" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "resolvedByPersonId" TEXT,
    "resolutionNote" TEXT,

    CONSTRAINT "MemberReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Friendship_requesterPersonId_addresseePersonId_key" ON "Friendship"("requesterPersonId", "addresseePersonId");
CREATE INDEX "Friendship_addresseePersonId_status_idx" ON "Friendship"("addresseePersonId", "status");
CREATE INDEX "Friendship_requesterPersonId_status_idx" ON "Friendship"("requesterPersonId", "status");
CREATE UNIQUE INDEX "PersonBlock_blockerPersonId_blockedPersonId_key" ON "PersonBlock"("blockerPersonId", "blockedPersonId");
CREATE INDEX "PersonBlock_blockedPersonId_idx" ON "PersonBlock"("blockedPersonId");
CREATE INDEX "MemberReport_status_createdAt_idx" ON "MemberReport"("status", "createdAt");
CREATE INDEX "MemberReport_reportedPersonId_idx" ON "MemberReport"("reportedPersonId");

-- AddForeignKey
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_requesterPersonId_fkey" FOREIGN KEY ("requesterPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_addresseePersonId_fkey" FOREIGN KEY ("addresseePersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonBlock" ADD CONSTRAINT "PersonBlock_blockerPersonId_fkey" FOREIGN KEY ("blockerPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonBlock" ADD CONSTRAINT "PersonBlock_blockedPersonId_fkey" FOREIGN KEY ("blockedPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemberReport" ADD CONSTRAINT "MemberReport_reporterPersonId_fkey" FOREIGN KEY ("reporterPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemberReport" ADD CONSTRAINT "MemberReport_reportedPersonId_fkey" FOREIGN KEY ("reportedPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemberReport" ADD CONSTRAINT "MemberReport_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
