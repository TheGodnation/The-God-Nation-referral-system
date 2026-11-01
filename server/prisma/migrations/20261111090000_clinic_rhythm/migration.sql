-- Dominion Clinic rhythm: topic rhythm, days between exams, questions per exam; exam-open reminder.
ALTER TYPE "NotificationType" ADD VALUE 'CLINIC_EXAM_OPEN';
CREATE TYPE "ClinicTopicRhythm" AS ENUM ('DAILY', 'EVERY_2_DAYS', 'EVERY_3_DAYS', 'MORNING_EVENING');
ALTER TABLE "Settings" ADD COLUMN "clinicTopicRhythm" "ClinicTopicRhythm" NOT NULL DEFAULT 'DAILY';
ALTER TABLE "Settings" ADD COLUMN "clinicExamEveryDays" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "Settings" ADD COLUMN "clinicExamQuestions" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "Assessment" ADD COLUMN "openReminderSentAt" TIMESTAMP(3);
