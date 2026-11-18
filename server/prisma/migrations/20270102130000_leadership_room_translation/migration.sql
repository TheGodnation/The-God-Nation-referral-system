-- AlterEnum
ALTER TYPE "TranslationRetryKind" ADD VALUE 'LEADERSHIP_ROOM_MESSAGE';

-- AlterTable
ALTER TABLE "LeadershipCollaborationMessage" ADD COLUMN     "detectedLanguage" "Language",
ADD COLUMN     "translatedAt" TIMESTAMP(3),
ADD COLUMN     "translatedBody" TEXT;
