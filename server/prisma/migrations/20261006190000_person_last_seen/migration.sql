-- "Online" / "last seen" for the WhatsApp-style chats.
ALTER TABLE "Person" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
