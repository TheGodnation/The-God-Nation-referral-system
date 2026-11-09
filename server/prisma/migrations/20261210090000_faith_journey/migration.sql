-- CreateEnum
CREATE TYPE "PersonalQuestionKind" AS ENUM ('CHOICE', 'TEXT');

-- CreateEnum
CREATE TYPE "FaithSignal" AS ENUM ('POSITIVE', 'NEEDS_TALK');

-- CreateEnum
CREATE TYPE "FaithStatus" AS ENUM ('BORN_AGAIN', 'NEEDS_CONVERSATION');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'FAITH_NEEDS_CONVERSATION';

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "leadersSeeFaithJourney" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PersonalQuestion" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "setNumber" INTEGER NOT NULL DEFAULT 1,
    "order" INTEGER NOT NULL DEFAULT 0,
    "kind" "PersonalQuestionKind" NOT NULL,
    "textEn" TEXT NOT NULL,
    "textFr" TEXT,
    "bodyEn" TEXT,
    "bodyFr" TEXT,
    "guideEn" TEXT,
    "guideFr" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "flagUnlessNone" BOOLEAN NOT NULL DEFAULT false,
    "affectsStatus" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalOption" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "textEn" TEXT NOT NULL,
    "textFr" TEXT,
    "signal" "FaithSignal" NOT NULL DEFAULT 'NEEDS_TALK',

    CONSTRAINT "PersonalOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalAnswer" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "questionId" TEXT,
    "optionId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "setNumber" INTEGER NOT NULL DEFAULT 1,
    "signal" "FaithSignal" NOT NULL,
    "questionEn" TEXT NOT NULL,
    "questionFr" TEXT,
    "answerEn" TEXT NOT NULL,
    "answerFr" TEXT,
    "guideEn" TEXT,
    "guideFr" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaithRecord" (
    "personId" TEXT NOT NULL,
    "status" "FaithStatus" NOT NULL,
    "lastAttemptId" TEXT,
    "lastAnsweredAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "confirmedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FaithRecord_pkey" PRIMARY KEY ("personId")
);

-- CreateTable
CREATE TABLE "FaithNote" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "authorPersonId" TEXT,
    "authorName" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FaithNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonalQuestion_assessmentId_setNumber_idx" ON "PersonalQuestion"("assessmentId", "setNumber");

-- CreateIndex
CREATE INDEX "PersonalOption_questionId_idx" ON "PersonalOption"("questionId");

-- CreateIndex
CREATE INDEX "PersonalAnswer_personId_idx" ON "PersonalAnswer"("personId");

-- CreateIndex
CREATE INDEX "PersonalAnswer_attemptId_order_idx" ON "PersonalAnswer"("attemptId", "order");

-- CreateIndex
CREATE INDEX "FaithRecord_status_idx" ON "FaithRecord"("status");

-- CreateIndex
CREATE INDEX "FaithNote_personId_createdAt_idx" ON "FaithNote"("personId", "createdAt");

-- AddForeignKey
ALTER TABLE "PersonalQuestion" ADD CONSTRAINT "PersonalQuestion_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalOption" ADD CONSTRAINT "PersonalOption_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "PersonalQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalAnswer" ADD CONSTRAINT "PersonalAnswer_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalAnswer" ADD CONSTRAINT "PersonalAnswer_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalAnswer" ADD CONSTRAINT "PersonalAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "PersonalQuestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalAnswer" ADD CONSTRAINT "PersonalAnswer_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "PersonalOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaithRecord" ADD CONSTRAINT "FaithRecord_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaithNote" ADD CONSTRAINT "FaithNote_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

