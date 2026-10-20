-- CreateEnum
CREATE TYPE "TranslationRetryKind" AS ENUM ('MESSAGE_TEXT', 'MESSAGE_AUDIO', 'UPDATE_POST');

-- CreateTable
CREATE TABLE "TranslationRetry" (
    "id" TEXT NOT NULL,
    "kind" "TranslationRetryKind" NOT NULL,
    "targetId" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TranslationRetry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TranslationRetry_nextAttemptAt_idx" ON "TranslationRetry"("nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "TranslationRetry_kind_targetId_key" ON "TranslationRetry"("kind", "targetId");

