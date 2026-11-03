-- Which referral link brought each registration (for the growth report by ambassador).
-- AlterTable
ALTER TABLE "Registration" ADD COLUMN     "referralCodeId" TEXT;

-- CreateIndex
CREATE INDEX "Registration_referralCodeId_idx" ON "Registration"("referralCodeId");

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_referralCodeId_fkey" FOREIGN KEY ("referralCodeId") REFERENCES "ReferralCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

