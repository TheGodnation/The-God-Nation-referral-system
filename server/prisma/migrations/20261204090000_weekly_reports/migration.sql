-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'REPORT_REMINDER';
ALTER TYPE "NotificationType" ADD VALUE 'REPORT_LATE';

-- CreateTable
CREATE TABLE "LeaderWeeklyReport" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "contacted" INTEGER NOT NULL,
    "needHelp" INTEGER NOT NULL,
    "prayerNeeds" TEXT,
    "note" TEXT,
    "late" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaderWeeklyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepresentativeWeeklySummary" (
    "id" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "weekStart" DATE NOT NULL,
    "personId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepresentativeWeeklySummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyReportReminder" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyReportReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeaderWeeklyReport_weekStart_idx" ON "LeaderWeeklyReport"("weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "LeaderWeeklyReport_personId_weekStart_key" ON "LeaderWeeklyReport"("personId", "weekStart");

-- CreateIndex
CREATE INDEX "RepresentativeWeeklySummary_weekStart_idx" ON "RepresentativeWeeklySummary"("weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "RepresentativeWeeklySummary_generation_weekStart_key" ON "RepresentativeWeeklySummary"("generation", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyReportReminder_personId_weekStart_kind_key" ON "WeeklyReportReminder"("personId", "weekStart", "kind");

-- AddForeignKey
ALTER TABLE "LeaderWeeklyReport" ADD CONSTRAINT "LeaderWeeklyReport_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

