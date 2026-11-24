-- Automatic WhatsApp messages through Meta's WhatsApp Business Platform: a switch (off by default) and a record of what was sent.
CREATE TYPE "WhatsAppCloudMode" AS ENUM ('OFF', 'TEST', 'ON');

ALTER TABLE "Settings" ADD COLUMN "whatsappCloudMode" "WhatsAppCloudMode" NOT NULL DEFAULT 'OFF';

CREATE TABLE "WhatsAppCloudSend" (
    "id" TEXT NOT NULL,
    "personId" TEXT,
    "toNumber" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "messageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppCloudSend_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WhatsAppCloudSend_createdAt_idx" ON "WhatsAppCloudSend"("createdAt");
CREATE INDEX "WhatsAppCloudSend_personId_idx" ON "WhatsAppCloudSend"("personId");
