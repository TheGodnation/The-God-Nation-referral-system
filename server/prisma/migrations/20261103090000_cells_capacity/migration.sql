-- Cells: an assembly holds ~200 members, then new members go to a new child assembly.
ALTER TABLE "Settings" ADD COLUMN "assemblyCapacity" INTEGER NOT NULL DEFAULT 200;
ALTER TABLE "Community" ADD COLUMN "autoCreated" BOOLEAN NOT NULL DEFAULT false;
ALTER TYPE "NotificationType" ADD VALUE 'ASSEMBLY_OPENED';
