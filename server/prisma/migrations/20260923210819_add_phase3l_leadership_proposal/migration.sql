-- CreateEnum
CREATE TYPE "LeadershipProposalStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "LeadershipProposal" (
    "id" TEXT NOT NULL,
    "proposedPersonId" TEXT NOT NULL,
    "geographyId" TEXT NOT NULL,
    "proposedByPersonId" TEXT NOT NULL,
    "status" "LeadershipProposalStatus" NOT NULL DEFAULT 'PROPOSED',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "decisionNote" TEXT,

    CONSTRAINT "LeadershipProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadershipProposal_proposedByPersonId_status_idx" ON "LeadershipProposal"("proposedByPersonId", "status");

-- CreateIndex
CREATE INDEX "LeadershipProposal_proposedPersonId_status_idx" ON "LeadershipProposal"("proposedPersonId", "status");

-- CreateIndex
CREATE INDEX "LeadershipProposal_geographyId_status_idx" ON "LeadershipProposal"("geographyId", "status");

-- AddForeignKey
ALTER TABLE "LeadershipProposal" ADD CONSTRAINT "LeadershipProposal_proposedPersonId_fkey" FOREIGN KEY ("proposedPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadershipProposal" ADD CONSTRAINT "LeadershipProposal_proposedByPersonId_fkey" FOREIGN KEY ("proposedByPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadershipProposal" ADD CONSTRAINT "LeadershipProposal_geographyId_fkey" FOREIGN KEY ("geographyId") REFERENCES "Geography"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadershipProposal" ADD CONSTRAINT "LeadershipProposal_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Manual addition (not expressible in Prisma's schema DSL): only one
-- PROPOSED (pending) LeadershipProposal may exist for a given candidate +
-- Geography at a time — the same partial-unique-index pattern already used
-- by FollowUpAssignment_active_follower_followed_key. Historical
-- APPROVED/REJECTED/WITHDRAWN rows are unaffected and may accumulate
-- freely, so a candidate can be re-proposed after a prior decision.
CREATE UNIQUE INDEX "LeadershipProposal_pending_candidate_geography_key"
    ON "LeadershipProposal" ("proposedPersonId", "geographyId")
    WHERE "status" = 'PROPOSED';
