-- Geography Retirement Step 5B: retire the organizational Geography
-- assignment/authorization layer. Geography Retirement Step 5A already
-- removed the GEOGRAPHY value from FollowUpAssignment.contextType; this
-- migration removes GeographicAssignment entirely and RoleAssignment's
-- geographyId column. SCOPED_LEADER is Community-scoped only from here on.
-- Safe only because the live diagnostic (and this repository's own dev/test
-- databases) confirmed zero GeographicAssignment rows and zero non-null
-- RoleAssignment.geographyId values before this migration was authored.
-- The Geography model itself, Geography.parentId, and Person's descriptive
-- locationCountry/City/Area fields are all untouched.

-- Manual removal (this constraint and the partial unique index below were
-- themselves manual, non-Prisma-tracked additions — see the original
-- migration in 20260922152419_add_phase3d_scoped_leadership_followup):
-- both reference geographyId directly, so both must be dropped before the
-- column itself, or the later DROP COLUMN fails.
ALTER TABLE "RoleAssignment" DROP CONSTRAINT "RoleAssignment_scope_exclusive_check";
DROP INDEX "RoleAssignment_active_person_geography_key";

-- DropForeignKey
ALTER TABLE "GeographicAssignment" DROP CONSTRAINT "GeographicAssignment_geographyId_fkey";

-- DropForeignKey
ALTER TABLE "GeographicAssignment" DROP CONSTRAINT "GeographicAssignment_personId_fkey";

-- DropForeignKey
ALTER TABLE "RoleAssignment" DROP CONSTRAINT "RoleAssignment_geographyId_fkey";

-- DropIndex
DROP INDEX "RoleAssignment_geographyId_idx";

-- AlterTable
ALTER TABLE "RoleAssignment" DROP COLUMN "geographyId";

-- DropTable
DROP TABLE "GeographicAssignment";
