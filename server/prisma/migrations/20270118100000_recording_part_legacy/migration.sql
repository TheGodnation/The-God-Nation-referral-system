-- Parts added before each part had its own text: their words are already inside the first part's text (and may already be
-- approved there). They are marked so they are not asked for again, not given a second text, and posted as voice only.
ALTER TABLE "TeachingRecordingPart" ADD COLUMN "textInFirstPart" BOOLEAN NOT NULL DEFAULT false;
UPDATE "TeachingRecordingPart" SET "textInFirstPart" = true WHERE "textState" = 'DONE' AND "transcript" IS NULL;
