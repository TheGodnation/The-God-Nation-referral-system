-- CreateTable
CREATE TABLE "CommunityConversationRead" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityConversationRead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpConversationRead" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowUpConversationRead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeographyConversationRead" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeographyConversationRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommunityConversationRead_personId_conversationId_key" ON "CommunityConversationRead"("personId", "conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "FollowUpConversationRead_personId_conversationId_key" ON "FollowUpConversationRead"("personId", "conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "GeographyConversationRead_personId_conversationId_key" ON "GeographyConversationRead"("personId", "conversationId");

-- AddForeignKey
ALTER TABLE "CommunityConversationRead" ADD CONSTRAINT "CommunityConversationRead_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityConversationRead" ADD CONSTRAINT "CommunityConversationRead_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpConversationRead" ADD CONSTRAINT "FollowUpConversationRead_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpConversationRead" ADD CONSTRAINT "FollowUpConversationRead_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "FollowUpConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeographyConversationRead" ADD CONSTRAINT "GeographyConversationRead_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeographyConversationRead" ADD CONSTRAINT "GeographyConversationRead_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "GeographyConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
