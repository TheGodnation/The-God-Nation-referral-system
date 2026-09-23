-- CreateTable
CREATE TABLE "FollowUpConversation" (
    "id" TEXT NOT NULL,
    "followUpAssignmentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowUpConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderPersonId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowUpMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FollowUpConversation_followUpAssignmentId_key" ON "FollowUpConversation"("followUpAssignmentId");

-- CreateIndex
CREATE INDEX "FollowUpMessage_conversationId_createdAt_idx" ON "FollowUpMessage"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "FollowUpConversation" ADD CONSTRAINT "FollowUpConversation_followUpAssignmentId_fkey" FOREIGN KEY ("followUpAssignmentId") REFERENCES "FollowUpAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpMessage" ADD CONSTRAINT "FollowUpMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "FollowUpConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpMessage" ADD CONSTRAINT "FollowUpMessage_senderPersonId_fkey" FOREIGN KEY ("senderPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

