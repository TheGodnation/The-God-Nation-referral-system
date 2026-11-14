-- Books a leader already completed while studying on WhatsApp: the first N books count as done (open, no payment
-- owed, passed for the certificate and "ready to lead").
ALTER TABLE "TrainingEnrollment" ADD COLUMN "booksCredited" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TrainingEnrollment" ADD COLUMN "booksCreditedAt" TIMESTAMP(3);
