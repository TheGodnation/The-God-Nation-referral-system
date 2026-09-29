-- DropForeignKey
ALTER TABLE "LeadershipProposal" DROP CONSTRAINT "LeadershipProposal_decidedByUserId_fkey";

-- DropForeignKey
ALTER TABLE "LeadershipProposal" DROP CONSTRAINT "LeadershipProposal_geographyId_fkey";

-- DropForeignKey
ALTER TABLE "LeadershipProposal" DROP CONSTRAINT "LeadershipProposal_proposedByPersonId_fkey";

-- DropForeignKey
ALTER TABLE "LeadershipProposal" DROP CONSTRAINT "LeadershipProposal_proposedPersonId_fkey";

-- DropTable
DROP TABLE "LeadershipProposal";

-- DropEnum
DROP TYPE "LeadershipProposalStatus";

