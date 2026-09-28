-- CreateEnum
CREATE TYPE "OrganizationalLeadershipRecommendationStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "OrganizationalLeadershipRecommendation" (
    "id" TEXT NOT NULL,
    "proposedPersonId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "proposedByPersonId" TEXT NOT NULL,
    "status" "OrganizationalLeadershipRecommendationStatus" NOT NULL DEFAULT 'PROPOSED',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "decisionNote" TEXT,

    CONSTRAINT "OrganizationalLeadershipRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrganizationalLeadershipRecommendation_proposedByPersonId_s_idx" ON "OrganizationalLeadershipRecommendation"("proposedByPersonId", "status");

-- CreateIndex
CREATE INDEX "OrganizationalLeadershipRecommendation_proposedPersonId_sta_idx" ON "OrganizationalLeadershipRecommendation"("proposedPersonId", "status");

-- CreateIndex
CREATE INDEX "OrganizationalLeadershipRecommendation_communityId_status_idx" ON "OrganizationalLeadershipRecommendation"("communityId", "status");

-- AddForeignKey
ALTER TABLE "OrganizationalLeadershipRecommendation" ADD CONSTRAINT "OrganizationalLeadershipRecommendation_proposedPersonId_fkey" FOREIGN KEY ("proposedPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationalLeadershipRecommendation" ADD CONSTRAINT "OrganizationalLeadershipRecommendation_proposedByPersonId_fkey" FOREIGN KEY ("proposedByPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationalLeadershipRecommendation" ADD CONSTRAINT "OrganizationalLeadershipRecommendation_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationalLeadershipRecommendation" ADD CONSTRAINT "OrganizationalLeadershipRecommendation_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Manual addition: no two PROPOSED (pending) recommendations may exist for
-- the exact same (proposer, candidate, anchor Community) triple — a partial
-- unique index, same precedent as RoleAssignment_active_person_community_key
-- (see 20260922152419_add_phase3d_scoped_leadership_followup/migration.sql).
-- Historical (APPROVED/REJECTED/WITHDRAWN) rows are unaffected, so the same
-- Leader may recommend the same candidate for the same Community again
-- later, after an earlier recommendation was decided or withdrawn.
CREATE UNIQUE INDEX "OrgLeadershipRecommendation_pending_triple_key"
    ON "OrganizationalLeadershipRecommendation" ("proposedByPersonId", "proposedPersonId", "communityId")
    WHERE "status" = 'PROPOSED';

