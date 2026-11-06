-- CreateEnum
CREATE TYPE "InstructionAudience" AS ENUM ('ALL_LEADERS', 'GENERATIONS', 'PICKED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'INSTRUCTION_RECEIVED';
ALTER TYPE "NotificationType" ADD VALUE 'INSTRUCTION_REMINDER';

-- CreateTable
CREATE TABLE "LeaderInstruction" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "language" "Language",
    "titleTr" TEXT,
    "bodyTr" TEXT,
    "audience" "InstructionAudience" NOT NULL,
    "generations" INTEGER[],
    "dueAt" TIMESTAMP(3),
    "repliesVisible" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT,
    "createdByPersonId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaderInstruction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaderInstructionRecipient" (
    "id" TEXT NOT NULL,
    "instructionId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "note" TEXT,
    "remindedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaderInstructionRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeaderInstruction_createdAt_idx" ON "LeaderInstruction"("createdAt");

-- CreateIndex
CREATE INDEX "LeaderInstructionRecipient_personId_idx" ON "LeaderInstructionRecipient"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaderInstructionRecipient_instructionId_personId_key" ON "LeaderInstructionRecipient"("instructionId", "personId");

-- AddForeignKey
ALTER TABLE "LeaderInstructionRecipient" ADD CONSTRAINT "LeaderInstructionRecipient_instructionId_fkey" FOREIGN KEY ("instructionId") REFERENCES "LeaderInstruction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaderInstructionRecipient" ADD CONSTRAINT "LeaderInstructionRecipient_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
