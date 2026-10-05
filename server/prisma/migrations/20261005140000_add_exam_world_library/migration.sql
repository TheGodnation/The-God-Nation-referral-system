-- CreateEnum
CREATE TYPE "LibraryBookKind" AS ENUM ('DEVOTIONAL', 'TRAINING');
CREATE TYPE "TrainingEnrollmentStatus" AS ENUM ('REQUESTED', 'ACTIVE', 'REVOKED');

-- AlterTable
ALTER TABLE "Assessment" ADD COLUMN "weekNumber" INTEGER,
ADD COLUMN "trainingBookId" TEXT;

-- CreateTable
CREATE TABLE "LibraryBook" (
    "id" TEXT NOT NULL,
    "kind" "LibraryBookKind" NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleFr" TEXT,
    "descriptionEn" TEXT,
    "descriptionFr" TEXT,
    "storageKey" TEXT,
    "byteSize" INTEGER,
    "trainingOrder" INTEGER,
    "devotionalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibraryBook_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrainingEnrollment" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "status" "TrainingEnrollmentStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "activatedByUserId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Assessment_trainingBookId_key" ON "Assessment"("trainingBookId");
CREATE UNIQUE INDEX "LibraryBook_trainingOrder_key" ON "LibraryBook"("trainingOrder");
CREATE UNIQUE INDEX "LibraryBook_devotionalId_key" ON "LibraryBook"("devotionalId");
CREATE INDEX "LibraryBook_kind_idx" ON "LibraryBook"("kind");
CREATE UNIQUE INDEX "TrainingEnrollment_personId_key" ON "TrainingEnrollment"("personId");
CREATE INDEX "TrainingEnrollment_status_idx" ON "TrainingEnrollment"("status");

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_trainingBookId_fkey" FOREIGN KEY ("trainingBookId") REFERENCES "LibraryBook"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LibraryBook" ADD CONSTRAINT "LibraryBook_devotionalId_fkey" FOREIGN KEY ("devotionalId") REFERENCES "MonthlyDevotional"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingEnrollment" ADD CONSTRAINT "TrainingEnrollment_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingEnrollment" ADD CONSTRAINT "TrainingEnrollment_activatedByUserId_fkey" FOREIGN KEY ("activatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Free-will offering for the monthly devotional
ALTER TABLE "Settings" ADD COLUMN "offeringInstructionsEn" TEXT,
ADD COLUMN "offeringInstructionsFr" TEXT;

CREATE TABLE "DevotionalOffering" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "devotionalId" TEXT NOT NULL,
    "amount" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'XAF',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DevotionalOffering_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DevotionalOffering_devotionalId_createdAt_idx" ON "DevotionalOffering"("devotionalId", "createdAt");
CREATE INDEX "DevotionalOffering_personId_idx" ON "DevotionalOffering"("personId");

ALTER TABLE "DevotionalOffering" ADD CONSTRAINT "DevotionalOffering_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DevotionalOffering" ADD CONSTRAINT "DevotionalOffering_devotionalId_fkey" FOREIGN KEY ("devotionalId") REFERENCES "MonthlyDevotional"("id") ON DELETE CASCADE ON UPDATE CASCADE;
