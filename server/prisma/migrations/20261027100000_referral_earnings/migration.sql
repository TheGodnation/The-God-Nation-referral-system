-- Notification types for referral earnings and payouts.
ALTER TYPE "NotificationType" ADD VALUE 'REFERRAL_EARNING';
ALTER TYPE "NotificationType" ADD VALUE 'REFERRAL_PAYOUT_PAID';
ALTER TYPE "NotificationType" ADD VALUE 'REFERRAL_PAYOUT_REJECTED';

-- CreateEnum
CREATE TYPE "EarningStatus" AS ENUM ('ACTIVE', 'REVERSED');
CREATE TYPE "PayoutStatus" AS ENUM ('REQUESTED', 'PAID', 'REJECTED', 'CANCELLED');

-- Commission settings (the existing settings row gets the defaults) and the new book price for new databases.
ALTER TABLE "Settings" ALTER COLUMN "trainingBookPrice" SET DEFAULT 1200;
ALTER TABLE "Settings"
  ADD COLUMN "referralCommission" INTEGER NOT NULL DEFAULT 500,
  ADD COLUMN "commissionHoldDays" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "payoutMinimum" INTEGER NOT NULL DEFAULT 5000;

-- CreateTable
CREATE TABLE "ReferralPayout" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "phone" TEXT NOT NULL,
    "payeeName" TEXT NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "reference" TEXT,
    "note" TEXT,

    CONSTRAINT "ReferralPayout_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReferralEarning" (
    "id" TEXT NOT NULL,
    "referrerPersonId" TEXT NOT NULL,
    "buyerPersonId" TEXT,
    "bookPaymentId" TEXT NOT NULL,
    "bookNumber" INTEGER,
    "amount" INTEGER NOT NULL,
    "status" "EarningStatus" NOT NULL DEFAULT 'ACTIVE',
    "availableAt" TIMESTAMP(3) NOT NULL,
    "payoutId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMP(3),

    CONSTRAINT "ReferralEarning_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReferralPayout_personId_status_idx" ON "ReferralPayout"("personId", "status");
CREATE INDEX "ReferralPayout_status_requestedAt_idx" ON "ReferralPayout"("status", "requestedAt");
CREATE UNIQUE INDEX "ReferralEarning_bookPaymentId_key" ON "ReferralEarning"("bookPaymentId");
CREATE INDEX "ReferralEarning_referrerPersonId_status_idx" ON "ReferralEarning"("referrerPersonId", "status");
CREATE INDEX "ReferralEarning_payoutId_idx" ON "ReferralEarning"("payoutId");

ALTER TABLE "ReferralPayout" ADD CONSTRAINT "ReferralPayout_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReferralPayout" ADD CONSTRAINT "ReferralPayout_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReferralEarning" ADD CONSTRAINT "ReferralEarning_referrerPersonId_fkey" FOREIGN KEY ("referrerPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReferralEarning" ADD CONSTRAINT "ReferralEarning_buyerPersonId_fkey" FOREIGN KEY ("buyerPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReferralEarning" ADD CONSTRAINT "ReferralEarning_bookPaymentId_fkey" FOREIGN KEY ("bookPaymentId") REFERENCES "BookPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReferralEarning" ADD CONSTRAINT "ReferralEarning_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "ReferralPayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;
