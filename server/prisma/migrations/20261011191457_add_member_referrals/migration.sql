-- AlterTable
ALTER TABLE "ReferralCode" ADD COLUMN     "personId" TEXT,
ALTER COLUMN "leaderId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Registration" ADD COLUMN     "referredByPersonId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ReferralCode_personId_key" ON "ReferralCode"("personId");

-- CreateIndex
CREATE INDEX "Registration_referredByPersonId_idx" ON "Registration"("referredByPersonId");

-- AddForeignKey
ALTER TABLE "ReferralCode" ADD CONSTRAINT "ReferralCode_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_referredByPersonId_fkey" FOREIGN KEY ("referredByPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
