-- AlterTable
ALTER TABLE "PrivateMessage" ADD COLUMN "detectedLanguage" "Language",
ADD COLUMN "translatedBody" TEXT,
ADD COLUMN "translatedAt" TIMESTAMP(3);
