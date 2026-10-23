-- CreateEnum
CREATE TYPE "RepresentationRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'REPRESENTATION_REQUEST_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'REPRESENTATION_REQUEST_DECLINED';

-- CreateTable
CREATE TABLE "RepresentationRequest" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "note" TEXT,
    "status" "RepresentationRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "decisionNote" TEXT,

    CONSTRAINT "RepresentationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RepresentationRequest_personId_status_idx" ON "RepresentationRequest"("personId", "status");

-- CreateIndex
CREATE INDEX "RepresentationRequest_status_idx" ON "RepresentationRequest"("status");

-- AddForeignKey
ALTER TABLE "RepresentationRequest" ADD CONSTRAINT "RepresentationRequest_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepresentationRequest" ADD CONSTRAINT "RepresentationRequest_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
