-- AlterTable
ALTER TABLE "ScheduledTeaching" ADD COLUMN "title" TEXT,
ADD COLUMN "quiz" JSONB,
ADD COLUMN "portionBookId" TEXT,
ADD COLUMN "portionPage" INTEGER,
ADD COLUMN "portionLabel" TEXT;
