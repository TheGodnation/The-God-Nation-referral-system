-- Private messages: replies, attachments (photos, voice notes, videos, PDFs) and reactions.
ALTER TABLE "PrivateMessage" ADD COLUMN "replyToMessageId" TEXT;
ALTER TABLE "PrivateMessage" ADD CONSTRAINT "PrivateMessage_replyToMessageId_fkey" FOREIGN KEY ("replyToMessageId") REFERENCES "PrivateMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PrivateMessageAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PrivateMessageAttachment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PrivateMessageAttachment_storageKey_key" ON "PrivateMessageAttachment"("storageKey");
CREATE INDEX "PrivateMessageAttachment_messageId_idx" ON "PrivateMessageAttachment"("messageId");
ALTER TABLE "PrivateMessageAttachment" ADD CONSTRAINT "PrivateMessageAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "PrivateMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PrivateMessageReaction" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "personId" TEXT,
    "userId" TEXT,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PrivateMessageReaction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PrivateMessageReaction_messageId_personId_key" ON "PrivateMessageReaction"("messageId", "personId");
CREATE UNIQUE INDEX "PrivateMessageReaction_messageId_userId_key" ON "PrivateMessageReaction"("messageId", "userId");
CREATE INDEX "PrivateMessageReaction_messageId_idx" ON "PrivateMessageReaction"("messageId");
ALTER TABLE "PrivateMessageReaction" ADD CONSTRAINT "PrivateMessageReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "PrivateMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrivateMessageReaction" ADD CONSTRAINT "PrivateMessageReaction_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrivateMessageReaction" ADD CONSTRAINT "PrivateMessageReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
