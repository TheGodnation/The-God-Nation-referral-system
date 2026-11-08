-- CreateTable
CREATE TABLE "LeaderBroadcast" (
    "id" TEXT NOT NULL,
    "senderPersonId" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "recipientCount" INTEGER NOT NULL,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "attachmentCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaderBroadcast_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeaderBroadcast_senderPersonId_createdAt_idx" ON "LeaderBroadcast"("senderPersonId", "createdAt");

-- CreateIndex
CREATE INDEX "LeaderBroadcast_createdAt_idx" ON "LeaderBroadcast"("createdAt");

-- AddForeignKey
ALTER TABLE "LeaderBroadcast" ADD CONSTRAINT "LeaderBroadcast_senderPersonId_fkey" FOREIGN KEY ("senderPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

