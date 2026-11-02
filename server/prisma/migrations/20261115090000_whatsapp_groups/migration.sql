-- WhatsApp groups (English and French) for the About page, and the assistance WhatsApp number.
ALTER TABLE "Settings" ADD COLUMN "whatsappGroupEnUrl" TEXT;
ALTER TABLE "Settings" ADD COLUMN "whatsappGroupFrUrl" TEXT;

-- One-time: the Assistance button on the Chats page opens a chat with +237 677 272 261.
-- Only fills it when nothing is set yet, and never runs again, so the admin can change or clear it in Settings.
INSERT INTO "Settings" ("id", "supportWhatsappUrl", "updatedAt")
VALUES ('singleton', 'https://wa.me/237677272261', now())
ON CONFLICT ("id") DO UPDATE SET "supportWhatsappUrl" = EXCLUDED."supportWhatsappUrl"
WHERE "Settings"."supportWhatsappUrl" IS NULL;
