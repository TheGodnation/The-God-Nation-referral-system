-- A voice note's length (milliseconds), measured by the sender's phone, so it can be shown before the audio downloads.
ALTER TABLE "MessageAttachment" ADD COLUMN "durationMs" INTEGER;
ALTER TABLE "PrivateMessageAttachment" ADD COLUMN "durationMs" INTEGER;
