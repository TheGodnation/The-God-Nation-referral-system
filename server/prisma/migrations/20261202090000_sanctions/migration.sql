-- CreateEnum
CREATE TYPE "SanctionRole" AS ENUM ('ADMIN', 'LEADER', 'REPRESENTATIVE');

-- CreateEnum
CREATE TYPE "RemovalRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'SANCTION_PLACED';
ALTER TYPE "NotificationType" ADD VALUE 'SANCTION_LIFTED';
ALTER TYPE "NotificationType" ADD VALUE 'SANCTION_ENDED';
ALTER TYPE "NotificationType" ADD VALUE 'EXCUSE_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'REMOVAL_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'REMOVAL_DECIDED';
ALTER TYPE "NotificationType" ADD VALUE 'REMOVED_FROM_ASSEMBLY';

-- CreateTable
CREATE TABLE "MemberSanction" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdByPersonId" TEXT,
    "createdByRole" "SanctionRole" NOT NULL,
    "liftedAt" TIMESTAMP(3),
    "liftedByPersonId" TEXT,
    "liftedByRole" "SanctionRole",
    "endNoticeSentAt" TIMESTAMP(3),
    "excuseMessage" TEXT,
    "excuseAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberSanction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RemovalRequest" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "requestedByPersonId" TEXT,
    "requestedByRole" "SanctionRole" NOT NULL,
    "status" "RemovalRequestStatus" NOT NULL DEFAULT 'PENDING',
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RemovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MemberSanction_personId_communityId_idx" ON "MemberSanction"("personId", "communityId");

-- CreateIndex
CREATE INDEX "MemberSanction_communityId_idx" ON "MemberSanction"("communityId");

-- CreateIndex
CREATE INDEX "MemberSanction_endsAt_idx" ON "MemberSanction"("endsAt");

-- CreateIndex
CREATE INDEX "RemovalRequest_status_createdAt_idx" ON "RemovalRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "RemovalRequest_communityId_idx" ON "RemovalRequest"("communityId");

-- AddForeignKey
ALTER TABLE "MemberSanction" ADD CONSTRAINT "MemberSanction_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberSanction" ADD CONSTRAINT "MemberSanction_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemovalRequest" ADD CONSTRAINT "RemovalRequest_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemovalRequest" ADD CONSTRAINT "RemovalRequest_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

