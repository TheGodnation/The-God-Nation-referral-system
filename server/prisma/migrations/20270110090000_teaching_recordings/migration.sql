-- CreateEnum
CREATE TYPE "TeachingRecordingStatus" AS ENUM ('RECORDED', 'WRITING', 'TEXT_READY', 'FAILED', 'APPROVED', 'POSTED');

-- CreateTable
CREATE TABLE "TeachingRecording" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "status" "TeachingRecordingStatus" NOT NULL DEFAULT 'RECORDED',
    "spokenLanguage" "Language",
    "transcript" TEXT,
    "translated" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "approvedAt" TIMESTAMP(3),
    "postedAt" TIMESTAMP(3),
    "messageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeachingRecording_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeachingRecording_storageKey_key" ON "TeachingRecording"("storageKey");

-- CreateIndex
CREATE INDEX "TeachingRecording_status_idx" ON "TeachingRecording"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TeachingRecording_teacherId_weekStart_key" ON "TeachingRecording"("teacherId", "weekStart");
