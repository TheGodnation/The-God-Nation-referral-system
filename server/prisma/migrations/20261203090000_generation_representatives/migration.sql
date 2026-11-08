-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'REPRESENTATIVE_APPOINTED';
ALTER TYPE "NotificationType" ADD VALUE 'REPRESENTATIVE_ENDED';

-- CreateTable
CREATE TABLE "GenerationRepresentative" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "appointedByUserId" TEXT,
    "appointedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endedByUserId" TEXT,

    CONSTRAINT "GenerationRepresentative_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GenerationRepresentative_personId_endedAt_idx" ON "GenerationRepresentative"("personId", "endedAt");

-- CreateIndex
CREATE INDEX "GenerationRepresentative_generation_endedAt_idx" ON "GenerationRepresentative"("generation", "endedAt");

-- AddForeignKey
ALTER TABLE "GenerationRepresentative" ADD CONSTRAINT "GenerationRepresentative_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

