-- CreateTable
CREATE TABLE "PrivateConversation" (
    "id" TEXT NOT NULL,
    "memberPersonId" TEXT NOT NULL,
    "initiatorUserId" TEXT,
    "initiatorPersonId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivateConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivateMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderPersonId" TEXT,
    "senderUserId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivateMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivateConversationRead" (
    "id" TEXT NOT NULL,
    "personId" TEXT,
    "userId" TEXT,
    "conversationId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivateConversationRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PrivateConversation_memberPersonId_idx" ON "PrivateConversation"("memberPersonId");

-- CreateIndex
CREATE UNIQUE INDEX "PrivateConversation_memberPersonId_initiatorUserId_key" ON "PrivateConversation"("memberPersonId", "initiatorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "PrivateConversation_memberPersonId_initiatorPersonId_key" ON "PrivateConversation"("memberPersonId", "initiatorPersonId");

-- CreateIndex
CREATE INDEX "PrivateMessage_conversationId_createdAt_idx" ON "PrivateMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrivateConversationRead_personId_conversationId_key" ON "PrivateConversationRead"("personId", "conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "PrivateConversationRead_userId_conversationId_key" ON "PrivateConversationRead"("userId", "conversationId");

-- AddForeignKey
ALTER TABLE "PrivateConversation" ADD CONSTRAINT "PrivateConversation_memberPersonId_fkey" FOREIGN KEY ("memberPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivateConversation" ADD CONSTRAINT "PrivateConversation_initiatorUserId_fkey" FOREIGN KEY ("initiatorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivateConversation" ADD CONSTRAINT "PrivateConversation_initiatorPersonId_fkey" FOREIGN KEY ("initiatorPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivateMessage" ADD CONSTRAINT "PrivateMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "PrivateConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivateMessage" ADD CONSTRAINT "PrivateMessage_senderPersonId_fkey" FOREIGN KEY ("senderPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivateMessage" ADD CONSTRAINT "PrivateMessage_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivateConversationRead" ADD CONSTRAINT "PrivateConversationRead_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivateConversationRead" ADD CONSTRAINT "PrivateConversationRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivateConversationRead" ADD CONSTRAINT "PrivateConversationRead_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "PrivateConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Private Communication / Messaging — identity-duality exclusivity
-- constraints, mirroring RoleAssignment_scope_exclusive_check /
-- AnnouncementTarget_scope_exclusive_check: exactly one of the two nullable
-- identity columns must be set, never both, never neither.
ALTER TABLE "PrivateConversation" ADD CONSTRAINT "PrivateConversation_initiator_exclusive_check"
    CHECK (
        ("initiatorUserId" IS NOT NULL AND "initiatorPersonId" IS NULL)
        OR ("initiatorUserId" IS NULL AND "initiatorPersonId" IS NOT NULL)
    );

ALTER TABLE "PrivateMessage" ADD CONSTRAINT "PrivateMessage_sender_exclusive_check"
    CHECK (
        ("senderUserId" IS NOT NULL AND "senderPersonId" IS NULL)
        OR ("senderUserId" IS NULL AND "senderPersonId" IS NOT NULL)
    );

ALTER TABLE "PrivateConversationRead" ADD CONSTRAINT "PrivateConversationRead_reader_exclusive_check"
    CHECK (
        ("userId" IS NOT NULL AND "personId" IS NULL)
        OR ("userId" IS NULL AND "personId" IS NOT NULL)
    );
