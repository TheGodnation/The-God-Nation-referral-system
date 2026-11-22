-- Books paid for on WhatsApp, kept apart from the books studied and passed there.
ALTER TABLE "TrainingEnrollment" ADD COLUMN "booksPaid" INTEGER NOT NULL DEFAULT 0;

-- Until now a book counted as done on WhatsApp was also counted as paid: keep every existing record exactly as it was.
UPDATE "TrainingEnrollment" SET "booksPaid" = "booksCredited";
