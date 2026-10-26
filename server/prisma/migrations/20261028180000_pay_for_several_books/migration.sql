-- Paying for several books at once: payments of one batch share a batchId; an order says how many books.
ALTER TABLE "BookPayment" ADD COLUMN "batchId" TEXT;
CREATE INDEX "BookPayment_batchId_idx" ON "BookPayment"("batchId");
ALTER TABLE "PaymentOrder" ADD COLUMN "bookCount" INTEGER NOT NULL DEFAULT 1;
