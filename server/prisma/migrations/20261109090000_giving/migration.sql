-- Giving: gifts to the central administration, campaigns, and how to give.
ALTER TYPE "NotificationType" ADD VALUE 'GIFT_CONFIRMED';
ALTER TYPE "NotificationType" ADD VALUE 'GIFT_REJECTED';

ALTER TABLE "Settings" ADD COLUMN "givingInstructionsEn" TEXT;
ALTER TABLE "Settings" ADD COLUMN "givingInstructionsFr" TEXT;
ALTER TABLE "Settings" ADD COLUMN "givingWeeklyPost" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Settings" ADD COLUMN "lastGivingPostAt" TIMESTAMP(3);

CREATE TYPE "GiftKind" AS ENUM ('OFFERING', 'TITHE', 'FREE_WILL', 'CAMPAIGN');
CREATE TYPE "GiftStatus" AS ENUM ('CLAIMED', 'CONFIRMED', 'REJECTED');
CREATE TYPE "GiftCampaignStatus" AS ENUM ('OPEN', 'CLOSED');

CREATE TABLE "GiftCampaign" (
    "id" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleFr" TEXT,
    "descriptionEn" TEXT,
    "descriptionFr" TEXT,
    "targetAmount" INTEGER,
    "status" "GiftCampaignStatus" NOT NULL DEFAULT 'OPEN',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "GiftCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Gift" (
    "id" TEXT NOT NULL,
    "personId" TEXT,
    "communityId" TEXT,
    "kind" "GiftKind" NOT NULL,
    "campaignId" TEXT,
    "amount" INTEGER NOT NULL,
    "reference" TEXT,
    "payerPhone" TEXT,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "status" "GiftStatus" NOT NULL DEFAULT 'CLAIMED',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,

    CONSTRAINT "Gift_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GiftCampaign_status_createdAt_idx" ON "GiftCampaign"("status", "createdAt");
CREATE INDEX "Gift_status_createdAt_idx" ON "Gift"("status", "createdAt");
CREATE INDEX "Gift_personId_createdAt_idx" ON "Gift"("personId", "createdAt");
CREATE INDEX "Gift_communityId_status_idx" ON "Gift"("communityId", "status");
CREATE INDEX "Gift_campaignId_status_idx" ON "Gift"("campaignId", "status");

ALTER TABLE "Gift" ADD CONSTRAINT "Gift_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Gift" ADD CONSTRAINT "Gift_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "GiftCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
