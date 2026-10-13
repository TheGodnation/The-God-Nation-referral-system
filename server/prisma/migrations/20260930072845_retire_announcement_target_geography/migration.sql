-- Geography Retirement Step 4: retire Geography-specific AnnouncementTarget
-- support. Drops the CHECK constraint first (it references geographyId
-- directly, so it must go before the column does), then the FK, index, and
-- column. Community targeting (AnnouncementTarget.communityId and its own
-- FK/index) is completely untouched.

-- Manual removal (this constraint was itself a manual, non-Prisma-tracked
-- addition — see the original migration in
-- 20260924140713_add_phase3m3_announcements): the exclusivity rule has no
-- meaning once geographyId no longer exists.
ALTER TABLE "AnnouncementTarget" DROP CONSTRAINT "AnnouncementTarget_scope_exclusive_check";

-- DropForeignKey
ALTER TABLE "AnnouncementTarget" DROP CONSTRAINT "AnnouncementTarget_geographyId_fkey";

-- DropIndex
DROP INDEX "AnnouncementTarget_geographyId_idx";

-- AlterTable
ALTER TABLE "AnnouncementTarget" DROP COLUMN "geographyId";
