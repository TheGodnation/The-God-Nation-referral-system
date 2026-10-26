-- A prompt to pay after passing a book, and reminders for payment orders nobody has answered.
ALTER TYPE "NotificationType" ADD VALUE 'BOOK_PASSED_PAY';
ALTER TABLE "PaymentOrder" ADD COLUMN "reminderSentAt" TIMESTAMP(3);
