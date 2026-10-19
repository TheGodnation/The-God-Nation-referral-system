-- Auto-translation: Message (group chat only, never PrivateMessage) and
-- UpdatePost. All columns nullable, no backfill — populated lazily in the
-- background after this migration ships; existing rows simply have no
-- translation until something re-translates them (nothing does, by design).

ALTER TABLE "Message" ADD COLUMN     "detectedLanguage" "Language";
ALTER TABLE "Message" ADD COLUMN     "translatedBody" TEXT;
ALTER TABLE "Message" ADD COLUMN     "translatedAt" TIMESTAMP(3);
ALTER TABLE "Message" ADD COLUMN     "transcribedBody" TEXT;
ALTER TABLE "Message" ADD COLUMN     "transcribedLanguage" "Language";
ALTER TABLE "Message" ADD COLUMN     "translatedTranscript" TEXT;
ALTER TABLE "Message" ADD COLUMN     "transcribedAt" TIMESTAMP(3);

ALTER TABLE "UpdatePost" ADD COLUMN     "detectedLanguage" "Language";
ALTER TABLE "UpdatePost" ADD COLUMN     "translatedBody" TEXT;
ALTER TABLE "UpdatePost" ADD COLUMN     "translatedAt" TIMESTAMP(3);
