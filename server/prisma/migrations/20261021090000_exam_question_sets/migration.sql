-- Leadership training exams: sets of questions, and retake requests.
ALTER TYPE "NotificationType" ADD VALUE 'EXAM_RETAKE_GRANTED';
ALTER TYPE "NotificationType" ADD VALUE 'EXAM_RETAKE_DECLINED';

ALTER TABLE "Question" ADD COLUMN "setNumber" INTEGER NOT NULL DEFAULT 1;
CREATE INDEX "Question_assessmentId_setNumber_idx" ON "Question"("assessmentId", "setNumber");

ALTER TABLE "Attempt" ADD COLUMN "setNumber" INTEGER;
ALTER TABLE "Attempt" ADD COLUMN "questionOrder" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE TYPE "ExamRetakeStatus" AS ENUM ('REQUESTED', 'GRANTED', 'DECLINED');

CREATE TABLE "ExamRetakeRequest" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "afterAttemptId" TEXT NOT NULL,
    "status" "ExamRetakeStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "usedByAttemptId" TEXT,
    CONSTRAINT "ExamRetakeRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExamRetakeRequest_usedByAttemptId_key" ON "ExamRetakeRequest"("usedByAttemptId");
CREATE INDEX "ExamRetakeRequest_status_requestedAt_idx" ON "ExamRetakeRequest"("status", "requestedAt");
CREATE INDEX "ExamRetakeRequest_personId_assessmentId_idx" ON "ExamRetakeRequest"("personId", "assessmentId");

ALTER TABLE "ExamRetakeRequest" ADD CONSTRAINT "ExamRetakeRequest_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExamRetakeRequest" ADD CONSTRAINT "ExamRetakeRequest_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExamRetakeRequest" ADD CONSTRAINT "ExamRetakeRequest_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ExamRetakeRequest" ADD CONSTRAINT "ExamRetakeRequest_usedByAttemptId_fkey" FOREIGN KEY ("usedByAttemptId") REFERENCES "Attempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
