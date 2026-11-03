-- More places people can join (WhatsApp channel, Telegram group, Facebook group) and which one a person tapped.
-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "detail" TEXT;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "facebookGroupUrl" TEXT,
ADD COLUMN     "telegramGroupUrl" TEXT,
ADD COLUMN     "whatsappChannelUrl" TEXT;

