-- CreateTable
CREATE TABLE "LeadershipCollaborationConversation" (
    "id" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadershipCollaborationConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadershipCollaborationMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderPersonId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadershipCollaborationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadershipCollaborationConversationRead" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadershipCollaborationConversationRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadershipCollaborationConversation_generation_key" ON "LeadershipCollaborationConversation"("generation");

-- CreateIndex
CREATE INDEX "LeadershipCollaborationMessage_conversationId_createdAt_idx" ON "LeadershipCollaborationMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeadershipCollaborationConversationRead_personId_conversati_key" ON "LeadershipCollaborationConversationRead"("personId", "conversationId");

-- AddForeignKey
ALTER TABLE "LeadershipCollaborationMessage" ADD CONSTRAINT "LeadershipCollaborationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "LeadershipCollaborationConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadershipCollaborationMessage" ADD CONSTRAINT "LeadershipCollaborationMessage_senderPersonId_fkey" FOREIGN KEY ("senderPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadershipCollaborationConversationRead" ADD CONSTRAINT "LeadershipCollaborationConversationRead_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadershipCollaborationConversationRead" ADD CONSTRAINT "LeadershipCollaborationConversationRead_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "LeadershipCollaborationConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

