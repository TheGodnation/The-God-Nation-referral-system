-- Comments under a Headquarters post can be replied to and reacted to.
-- AlterTable
ALTER TABLE "HeadquartersPostComment" ADD COLUMN     "parentCommentId" TEXT;

-- CreateTable
CREATE TABLE "HeadquartersPostCommentReaction" (
    "id" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "type" "UpdateReactionType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HeadquartersPostCommentReaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HeadquartersPostCommentReaction_commentId_idx" ON "HeadquartersPostCommentReaction"("commentId");

-- CreateIndex
CREATE UNIQUE INDEX "HeadquartersPostCommentReaction_commentId_personId_key" ON "HeadquartersPostCommentReaction"("commentId", "personId");

-- AddForeignKey
ALTER TABLE "HeadquartersPostComment" ADD CONSTRAINT "HeadquartersPostComment_parentCommentId_fkey" FOREIGN KEY ("parentCommentId") REFERENCES "HeadquartersPostComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeadquartersPostCommentReaction" ADD CONSTRAINT "HeadquartersPostCommentReaction_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "HeadquartersPostComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeadquartersPostCommentReaction" ADD CONSTRAINT "HeadquartersPostCommentReaction_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

