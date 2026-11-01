-- King's Token spending: Earned tokens toward a book (held, then settled or released).
ALTER TYPE "TokenKind" ADD VALUE 'BURNED';
ALTER TYPE "TokenReason" ADD VALUE 'SPEND_HOLD';
ALTER TYPE "TokenReason" ADD VALUE 'SPEND_RELEASE';
ALTER TYPE "TokenReason" ADD VALUE 'TREASURY_SHARE';
ALTER TYPE "TokenReason" ADD VALUE 'SPEND_BURN';

ALTER TABLE "TokenEntry" ADD COLUMN "bookPaymentId" TEXT;
CREATE UNIQUE INDEX "TokenEntry_bookPaymentId_reason_key" ON "TokenEntry"("bookPaymentId", "reason");

ALTER TABLE "Settings" ADD COLUMN "tokenSpendEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Settings" ADD COLUMN "tokenValueFcfa" DECIMAL(12,6) NOT NULL DEFAULT 1;
ALTER TABLE "Settings" ADD COLUMN "tokenSpendMaxPercent" INTEGER NOT NULL DEFAULT 30;

ALTER TABLE "BookPayment" ADD COLUMN "tokensApplied" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BookPayment" ADD COLUMN "tokenFrancs" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "PaymentOrder" ADD COLUMN "tokensApplied" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PaymentOrder" ADD COLUMN "tokenFrancs" INTEGER NOT NULL DEFAULT 0;
