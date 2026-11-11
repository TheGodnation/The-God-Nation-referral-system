-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "assemblyAgreementFrom" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AssemblyAgreement" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "agreedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssemblyAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssemblyAgreement_communityId_idx" ON "AssemblyAgreement"("communityId");

-- CreateIndex
CREATE UNIQUE INDEX "AssemblyAgreement_personId_communityId_key" ON "AssemblyAgreement"("personId", "communityId");

-- AddForeignKey
ALTER TABLE "AssemblyAgreement" ADD CONSTRAINT "AssemblyAgreement_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssemblyAgreement" ADD CONSTRAINT "AssemblyAgreement_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The rule starts now: everyone who already has an account is left alone; only people who sign up after this moment agree.
UPDATE "Settings" SET "assemblyAgreementFrom" = now() WHERE "assemblyAgreementFrom" IS NULL;
