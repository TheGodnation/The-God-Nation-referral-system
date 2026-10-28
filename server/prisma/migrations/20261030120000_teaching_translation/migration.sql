-- Teachings are auto-translated English <-> French (title, text, quiz).
ALTER TYPE "TranslationRetryKind" ADD VALUE 'TEACHING';

ALTER TABLE "Teaching" ADD COLUMN "detectedLanguage" "Language",
ADD COLUMN "titleTranslated" TEXT,
ADD COLUMN "textTranslated" TEXT,
ADD COLUMN "translatedAt" TIMESTAMP(3);
