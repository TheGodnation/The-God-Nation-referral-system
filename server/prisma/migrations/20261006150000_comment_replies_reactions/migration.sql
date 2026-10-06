-- Replies and reactions on Updates comments.
ALTER TABLE "UpdateComment" ADD COLUMN "parentCommentId" TEXT;
ALTER TABLE "UpdateComment" ADD CONSTRAINT "UpdateComment_parentCommentId_fkey" FOREIGN KEY ("parentCommentId") REFERENCES "UpdateComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "UpdateCommentReaction" (
    "id" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "type" "UpdateReactionType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UpdateCommentReaction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UpdateCommentReaction_commentId_personId_key" ON "UpdateCommentReaction"("commentId", "personId");
CREATE INDEX "UpdateCommentReaction_commentId_idx" ON "UpdateCommentReaction"("commentId");
ALTER TABLE "UpdateCommentReaction" ADD CONSTRAINT "UpdateCommentReaction_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "UpdateComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UpdateCommentReaction" ADD CONSTRAINT "UpdateCommentReaction_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
