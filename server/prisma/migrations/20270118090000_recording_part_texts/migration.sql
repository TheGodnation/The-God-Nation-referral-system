-- Each part of a teaching recorded ahead of time has its own text, approval and translation.
ALTER TABLE "TeachingRecordingPart" ADD COLUMN "transcript" TEXT;
ALTER TABLE "TeachingRecordingPart" ADD COLUMN "translated" TEXT;
ALTER TABLE "TeachingRecordingPart" ADD COLUMN "spokenLanguage" "Language";
ALTER TABLE "TeachingRecordingPart" ADD COLUMN "approvedAt" TIMESTAMP(3);
ALTER TABLE "TeachingRecordingPart" ADD COLUMN "translateAttempts" INTEGER NOT NULL DEFAULT 0;

-- Recordings that were only "waiting" because an added part was being written into the first part's text: each part now keeps its
-- own text, so the first part shows its own state again.
UPDATE "TeachingRecording"
SET "status" = CASE WHEN COALESCE(TRIM("transcript"), '') <> '' THEN 'TEXT_READY'::"TeachingRecordingStatus" ELSE 'FAILED'::"TeachingRecordingStatus" END
WHERE "status" = 'WRITING' AND "mainTextDone" = true;
