-- Voice-to-voice translation: a synthesized audio version of a voice
-- note's translated transcript. Nullable, no backfill — populated lazily
-- in the background going forward, same as every other translation field.

ALTER TABLE "Message" ADD COLUMN     "translatedAudioStorageKey" TEXT;
ALTER TABLE "Message" ADD COLUMN     "translatedAudioMimeType" TEXT;
ALTER TABLE "Message" ADD COLUMN     "translatedAudioLanguage" "Language";
ALTER TABLE "Message" ADD COLUMN     "translatedAudioAt" TIMESTAMP(3);
