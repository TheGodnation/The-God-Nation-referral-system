-- A voice message the central admin recorded in both languages, and the "live teaching" mark.
ALTER TABLE "MessageAttachment" ADD COLUMN "language" "Language";
ALTER TABLE "Message" ADD COLUMN "liveTeaching" BOOLEAN NOT NULL DEFAULT false;
