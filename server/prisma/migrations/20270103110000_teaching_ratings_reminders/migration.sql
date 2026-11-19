-- AlterTable
ALTER TABLE "TeachingSettings" ADD COLUMN "ratersCommunityId" TEXT;

-- CreateTable
CREATE TABLE "TeachingRating" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "raterPersonId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeachingRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeachingReminderLog" (
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeachingReminderLog_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeachingRating_teacherId_weekStart_raterPersonId_key" ON "TeachingRating"("teacherId", "weekStart", "raterPersonId");

-- CreateIndex
CREATE INDEX "TeachingRating_teacherId_weekStart_idx" ON "TeachingRating"("teacherId", "weekStart");

-- CreateIndex
CREATE INDEX "TeachingRating_raterPersonId_weekStart_idx" ON "TeachingRating"("raterPersonId", "weekStart");
