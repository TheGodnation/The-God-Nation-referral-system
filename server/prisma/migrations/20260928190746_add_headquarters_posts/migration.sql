-- CreateTable
CREATE TABLE "HeadquartersPost" (
    "id" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleFr" TEXT,
    "bodyEn" TEXT NOT NULL,
    "bodyFr" TEXT,
    "networkWide" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "HeadquartersPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HeadquartersPostTarget" (
    "id" TEXT NOT NULL,
    "headquartersPostId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HeadquartersPostTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HeadquartersPostComment" (
    "id" TEXT NOT NULL,
    "headquartersPostId" TEXT NOT NULL,
    "authorPersonId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HeadquartersPostComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HeadquartersPostReaction" (
    "id" TEXT NOT NULL,
    "headquartersPostId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HeadquartersPostReaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HeadquartersPost_publishedAt_archivedAt_idx" ON "HeadquartersPost"("publishedAt", "archivedAt");

-- CreateIndex
CREATE INDEX "HeadquartersPost_createdAt_idx" ON "HeadquartersPost"("createdAt");

-- CreateIndex
CREATE INDEX "HeadquartersPostTarget_headquartersPostId_idx" ON "HeadquartersPostTarget"("headquartersPostId");

-- CreateIndex
CREATE INDEX "HeadquartersPostTarget_communityId_idx" ON "HeadquartersPostTarget"("communityId");

-- CreateIndex
CREATE INDEX "HeadquartersPostComment_headquartersPostId_createdAt_idx" ON "HeadquartersPostComment"("headquartersPostId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "HeadquartersPostReaction_headquartersPostId_personId_key" ON "HeadquartersPostReaction"("headquartersPostId", "personId");

-- AddForeignKey
ALTER TABLE "HeadquartersPost" ADD CONSTRAINT "HeadquartersPost_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeadquartersPostTarget" ADD CONSTRAINT "HeadquartersPostTarget_headquartersPostId_fkey" FOREIGN KEY ("headquartersPostId") REFERENCES "HeadquartersPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeadquartersPostTarget" ADD CONSTRAINT "HeadquartersPostTarget_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeadquartersPostComment" ADD CONSTRAINT "HeadquartersPostComment_headquartersPostId_fkey" FOREIGN KEY ("headquartersPostId") REFERENCES "HeadquartersPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeadquartersPostComment" ADD CONSTRAINT "HeadquartersPostComment_authorPersonId_fkey" FOREIGN KEY ("authorPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeadquartersPostReaction" ADD CONSTRAINT "HeadquartersPostReaction_headquartersPostId_fkey" FOREIGN KEY ("headquartersPostId") REFERENCES "HeadquartersPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeadquartersPostReaction" ADD CONSTRAINT "HeadquartersPostReaction_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

