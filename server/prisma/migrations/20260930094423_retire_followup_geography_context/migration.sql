-- Geography Retirement Step 5A: retire the GEOGRAPHY value from
-- FollowUpAssignment.contextType. Follow-Up is now Community-scoped only.
-- Safe only because zero rows currently use contextType = 'GEOGRAPHY' (
-- verified via GET /api/admin/diagnostics/geography-dependencies before this
-- migration was authored) — PostgreSQL has no ALTER TYPE ... DROP VALUE, so
-- the enum is recreated without GEOGRAPHY and the column is converted to it.
-- GeographicAssignment and RoleAssignment.geographyId are untouched; they are
-- retired in a later, dedicated step.
BEGIN;
CREATE TYPE "FollowUpContextType_new" AS ENUM ('COMMUNITY');
ALTER TABLE "FollowUpAssignment" ALTER COLUMN "contextType" TYPE "FollowUpContextType_new" USING ("contextType"::text::"FollowUpContextType_new");
ALTER TYPE "FollowUpContextType" RENAME TO "FollowUpContextType_old";
ALTER TYPE "FollowUpContextType_new" RENAME TO "FollowUpContextType";
DROP TYPE "FollowUpContextType_old";
COMMIT;
