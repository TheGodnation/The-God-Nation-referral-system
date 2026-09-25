-- CreateTable
CREATE TABLE "GeographyConversation" (
    "id" TEXT NOT NULL,
    "geographyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeographyConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeographyMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderPersonId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeographyMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GeographyConversation_geographyId_key" ON "GeographyConversation"("geographyId");

-- CreateIndex
CREATE INDEX "GeographyMessage_conversationId_createdAt_idx" ON "GeographyMessage"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "GeographyConversation" ADD CONSTRAINT "GeographyConversation_geographyId_fkey" FOREIGN KEY ("geographyId") REFERENCES "Geography"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeographyMessage" ADD CONSTRAINT "GeographyMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "GeographyConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeographyMessage" ADD CONSTRAINT "GeographyMessage_senderPersonId_fkey" FOREIGN KEY ("senderPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
