-- Headquarters posts and announcements: retry a failed automatic translation later, and remember
-- when an announcement's French was filled in automatically.
ALTER TYPE "TranslationRetryKind" ADD VALUE 'HEADQUARTERS_POST';
ALTER TYPE "TranslationRetryKind" ADD VALUE 'ANNOUNCEMENT';
ALTER TABLE "Announcement" ADD COLUMN "frAutoTranslated" BOOLEAN NOT NULL DEFAULT false;
