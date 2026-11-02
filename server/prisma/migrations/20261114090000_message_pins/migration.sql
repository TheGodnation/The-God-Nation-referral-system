-- Pinned messages at the top of an assembly's chat, and who has opened each pin.
CREATE TABLE "MessagePin" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "pinnedByPersonId" TEXT,
    "pinnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessagePin_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MessagePinSeen" (
    "id" TEXT NOT NULL,
    "pinId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessagePinSeen_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MessagePin_messageId_key" ON "MessagePin"("messageId");
CREATE INDEX "MessagePin_conversationId_pinnedAt_idx" ON "MessagePin"("conversationId", "pinnedAt");
CREATE UNIQUE INDEX "MessagePinSeen_pinId_personId_key" ON "MessagePinSeen"("pinId", "personId");
CREATE INDEX "MessagePinSeen_personId_idx" ON "MessagePinSeen"("personId");

ALTER TABLE "MessagePin" ADD CONSTRAINT "MessagePin_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessagePin" ADD CONSTRAINT "MessagePin_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessagePin" ADD CONSTRAINT "MessagePin_pinnedByPersonId_fkey" FOREIGN KEY ("pinnedByPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MessagePinSeen" ADD CONSTRAINT "MessagePinSeen_pinId_fkey" FOREIGN KEY ("pinId") REFERENCES "MessagePin"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessagePinSeen" ADD CONSTRAINT "MessagePinSeen_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
