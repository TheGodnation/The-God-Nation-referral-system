-- CreateEnum
CREATE TYPE "UpdateReactionType" AS ENUM ('LIKE', 'LOVE', 'PRAY', 'PRAISE', 'JOY', 'SAD');

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN "liveYoutubeVideoId" TEXT,
ADD COLUMN "liveTitle" TEXT,
ADD COLUMN "liveStartedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "UpdatePost" (
    "id" TEXT NOT NULL,
    "authorPersonId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "youtubeVideoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedByPersonId" TEXT,
    "deletedByUserId" TEXT,

    CONSTRAINT "UpdatePost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpdatePostPhoto" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UpdatePostPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpdateComment" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "authorPersonId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "deletedByPersonId" TEXT,
    "deletedByUserId" TEXT,

    CONSTRAINT "UpdateComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpdateReaction" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "type" "UpdateReactionType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UpdateReaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UpdatePost_createdAt_idx" ON "UpdatePost"("createdAt");
CREATE INDEX "UpdatePost_authorPersonId_idx" ON "UpdatePost"("authorPersonId");
CREATE INDEX "UpdatePost_deletedAt_idx" ON "UpdatePost"("deletedAt");
CREATE INDEX "UpdatePostPhoto_postId_idx" ON "UpdatePostPhoto"("postId");
CREATE INDEX "UpdateComment_postId_createdAt_idx" ON "UpdateComment"("postId", "createdAt");
CREATE UNIQUE INDEX "UpdateReaction_postId_personId_key" ON "UpdateReaction"("postId", "personId");

-- AddForeignKey
ALTER TABLE "UpdatePost" ADD CONSTRAINT "UpdatePost_authorPersonId_fkey" FOREIGN KEY ("authorPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UpdatePost" ADD CONSTRAINT "UpdatePost_deletedByPersonId_fkey" FOREIGN KEY ("deletedByPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UpdatePost" ADD CONSTRAINT "UpdatePost_deletedByUserId_fkey" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UpdatePostPhoto" ADD CONSTRAINT "UpdatePostPhoto_postId_fkey" FOREIGN KEY ("postId") REFERENCES "UpdatePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UpdateComment" ADD CONSTRAINT "UpdateComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "UpdatePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UpdateComment" ADD CONSTRAINT "UpdateComment_authorPersonId_fkey" FOREIGN KEY ("authorPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UpdateComment" ADD CONSTRAINT "UpdateComment_deletedByPersonId_fkey" FOREIGN KEY ("deletedByPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UpdateComment" ADD CONSTRAINT "UpdateComment_deletedByUserId_fkey" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UpdateReaction" ADD CONSTRAINT "UpdateReaction_postId_fkey" FOREIGN KEY ("postId") REFERENCES "UpdatePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UpdateReaction" ADD CONSTRAINT "UpdateReaction_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
