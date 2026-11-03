-- Growth foundation (Phase A): ad click codes on visits and registrations, 'stay connected' leads, recorded consent, and the WhatsApp-group click event.
-- CreateEnum
CREATE TYPE "ConsentChannel" AS ENUM ('WHATSAPP', 'EMAIL');

-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'GROUP_LINK_CLICKED';

-- AlterTable
ALTER TABLE "ReferralVisit" ADD COLUMN     "fbclid" TEXT,
ADD COLUMN     "gclid" TEXT,
ADD COLUMN     "referrerHost" TEXT,
ADD COLUMN     "ttclid" TEXT,
ADD COLUMN     "utmContent" TEXT;

-- AlterTable
ALTER TABLE "Registration" ADD COLUMN     "fbclid" TEXT,
ADD COLUMN     "gclid" TEXT,
ADD COLUMN     "referrerHost" TEXT,
ADD COLUMN     "ttclid" TEXT,
ADD COLUMN     "utmContent" TEXT;

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "whatsappNumber" TEXT NOT NULL,
    "language" "Language" NOT NULL DEFAULT 'en',
    "visitorId" TEXT,
    "referralCodeId" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "fbclid" TEXT,
    "ttclid" TEXT,
    "gclid" TEXT,
    "referrerHost" TEXT,
    "landingPage" TEXT,
    "isTestData" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "convertedPersonId" TEXT,
    "convertedAt" TIMESTAMP(3),

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactConsent" (
    "id" TEXT NOT NULL,
    "personId" TEXT,
    "leadId" TEXT,
    "channel" "ConsentChannel" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "wording" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Lead_whatsappNumber_key" ON "Lead"("whatsappNumber");

-- CreateIndex
CREATE INDEX "Lead_createdAt_idx" ON "Lead"("createdAt");

-- CreateIndex
CREATE INDEX "Lead_convertedPersonId_idx" ON "Lead"("convertedPersonId");

-- CreateIndex
CREATE INDEX "Lead_utmSource_idx" ON "Lead"("utmSource");

-- CreateIndex
CREATE INDEX "ContactConsent_personId_channel_createdAt_idx" ON "ContactConsent"("personId", "channel", "createdAt");

-- CreateIndex
CREATE INDEX "ContactConsent_leadId_channel_createdAt_idx" ON "ContactConsent"("leadId", "channel", "createdAt");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_convertedPersonId_fkey" FOREIGN KEY ("convertedPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactConsent" ADD CONSTRAINT "ContactConsent_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactConsent" ADD CONSTRAINT "ContactConsent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

