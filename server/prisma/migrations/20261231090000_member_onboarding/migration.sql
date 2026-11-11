-- AlterTable
ALTER TABLE "MemberAccount" ADD COLUMN     "firstLoginAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MemberOnboarding" (
    "personId" TEXT NOT NULL,
    "welcomeMessageSentAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberOnboarding_pkey" PRIMARY KEY ("personId")
);

-- AddForeignKey
ALTER TABLE "MemberOnboarding" ADD CONSTRAINT "MemberOnboarding_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

