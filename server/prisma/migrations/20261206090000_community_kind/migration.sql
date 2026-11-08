-- CreateEnum
CREATE TYPE "CommunityKind" AS ENUM ('ASSEMBLY', 'GROUP');

-- AlterTable
ALTER TABLE "Community" ADD COLUMN     "kind" "CommunityKind" NOT NULL DEFAULT 'ASSEMBLY';


-- The assembly that used to be the Headquarters (now directly under the current one) is the Leadership Team: a group,
-- not a generation, and not open to newcomers.
UPDATE "Community" AS c
SET "kind" = 'GROUP', "autoPlacementEligible" = false
WHERE c."parentId" = (SELECT s."headquartersCommunityId" FROM "Settings" AS s WHERE s."id" = 'singleton')
  AND c."id" IN (
    SELECT a."metadata"->>'previousHeadquartersId' FROM "AuditLog" AS a WHERE a."action" = 'HEADQUARTERS_COMMUNITY_REPLACED'
  );
