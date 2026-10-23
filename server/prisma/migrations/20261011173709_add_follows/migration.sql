-- CreateTable
CREATE TABLE "Follow" (
    "id" TEXT NOT NULL,
    "followerPersonId" TEXT NOT NULL,
    "followingPersonId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Follow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Follow_followingPersonId_idx" ON "Follow"("followingPersonId");

-- CreateIndex
CREATE INDEX "Follow_followerPersonId_idx" ON "Follow"("followerPersonId");

-- CreateIndex
CREATE UNIQUE INDEX "Follow_followerPersonId_followingPersonId_key" ON "Follow"("followerPersonId", "followingPersonId");

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followerPersonId_fkey" FOREIGN KEY ("followerPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followingPersonId_fkey" FOREIGN KEY ("followingPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
