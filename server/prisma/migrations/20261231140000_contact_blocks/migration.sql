-- CreateEnum
CREATE TYPE "ContactBlockKind" AS ENUM ('WHATSAPP', 'EMAIL');

-- CreateEnum
CREATE TYPE "ContactBlockMode" AS ENUM ('APPROVAL', 'NEVER');

-- CreateEnum
CREATE TYPE "ContactBlockStatus" AS ENUM ('ACTIVE', 'APPROVED', 'LIFTED');

-- CreateTable
CREATE TABLE "ContactBlock" (
    "id" TEXT NOT NULL,
    "kind" "ContactBlockKind" NOT NULL,
    "value" TEXT NOT NULL,
    "mode" "ContactBlockMode" NOT NULL,
    "status" "ContactBlockStatus" NOT NULL DEFAULT 'ACTIVE',
    "groupId" TEXT NOT NULL,
    "personName" TEXT,
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "lastAttemptVia" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "ContactBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContactBlock_status_lastAttemptAt_idx" ON "ContactBlock"("status", "lastAttemptAt");

-- CreateIndex
CREATE INDEX "ContactBlock_groupId_idx" ON "ContactBlock"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactBlock_kind_value_key" ON "ContactBlock"("kind", "value");

