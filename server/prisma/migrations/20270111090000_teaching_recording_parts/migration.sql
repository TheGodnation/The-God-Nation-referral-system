-- CreateEnum
CREATE TYPE "TeachingPartText" AS ENUM ('WAITING', 'DONE', 'FAILED');

-- AlterTable
ALTER TABLE "TeachingRecording" ADD COLUMN "mainTextDone" BOOLEAN NOT NULL DEFAULT false;
UPDATE "TeachingRecording" SET "mainTextDone" = true WHERE "transcript" IS NOT NULL AND "status" IN ('TEXT_READY', 'APPROVED', 'POSTED');

-- CreateTable
CREATE TABLE "TeachingRecordingPart" (
    "id" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "textState" "TeachingPartText" NOT NULL DEFAULT 'WAITING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeachingRecordingPart_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeachingRecordingPart_storageKey_key" ON "TeachingRecordingPart"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "TeachingRecordingPart_recordingId_position_key" ON "TeachingRecordingPart"("recordingId", "position");

-- AddForeignKey
ALTER TABLE "TeachingRecordingPart" ADD CONSTRAINT "TeachingRecordingPart_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "TeachingRecording"("id") ON DELETE CASCADE ON UPDATE CASCADE;
