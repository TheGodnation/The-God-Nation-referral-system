-- CreateEnum
CREATE TYPE "AccountDeletionStatus" AS ENUM ('PENDING', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "AccountDeletionSource" AS ENUM ('APP', 'WEB');

-- DropForeignKey
ALTER TABLE "DevotionalOffering" DROP CONSTRAINT "DevotionalOffering_personId_fkey";

-- AlterTable
ALTER TABLE "DevotionalOffering" ALTER COLUMN "personId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "deletionRequestedAt" TIMESTAMP(3),
ADD COLUMN     "erasedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AccountDeletionRequest" (
    "id" TEXT NOT NULL,
    "personId" TEXT,
    "status" "AccountDeletionStatus" NOT NULL DEFAULT 'PENDING',
    "source" "AccountDeletionSource" NOT NULL DEFAULT 'APP',
    "personName" TEXT,
    "email" TEXT,
    "whatsappNumber" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "returned" JSONB,

    CONSTRAINT "AccountDeletionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountDeletionCode" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountDeletionCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountDeletionRequest_status_readyAt_idx" ON "AccountDeletionRequest"("status", "readyAt");

-- CreateIndex
CREATE INDEX "AccountDeletionRequest_personId_idx" ON "AccountDeletionRequest"("personId");

-- CreateIndex
CREATE INDEX "AccountDeletionCode_email_idx" ON "AccountDeletionCode"("email");

-- AddForeignKey
ALTER TABLE "DevotionalOffering" ADD CONSTRAINT "DevotionalOffering_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountDeletionRequest" ADD CONSTRAINT "AccountDeletionRequest_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

