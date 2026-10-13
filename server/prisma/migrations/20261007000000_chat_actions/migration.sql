-- Edit, delete for everyone, forward, and mute for the WhatsApp-style chats.
ALTER TABLE "Message" ADD COLUMN "editedAt" TIMESTAMP(3),
  ADD COLUMN "forwarded" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PrivateMessage" ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "editedAt" TIMESTAMP(3),
  ADD COLUMN "forwarded" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "GroupChatMute" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "until" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GroupChatMute_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GroupChatMute_personId_communityId_key" ON "GroupChatMute"("personId", "communityId");
ALTER TABLE "GroupChatMute" ADD CONSTRAINT "GroupChatMute_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupChatMute" ADD CONSTRAINT "GroupChatMute_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
