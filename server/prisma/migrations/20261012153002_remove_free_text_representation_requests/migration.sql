-- Removes the old free-text RepresentationRequest feature (a Member's own
-- "I want to represent X" label, decided by Admin but never granting a real
-- role) in favor of the Geographical Leadership Directory
-- (AreaRepresentationRequest / AreaLeadershipAssignment) being the sole
-- Leadership Directory going forward.
--
-- Any existing REPRESENTATION_REQUEST_APPROVED/_DECLINED Notification rows
-- are deleted first — they reference a type value this migration removes
-- from the enum, and the feature they describe no longer exists to view.
DELETE FROM "Notification" WHERE "type" IN ('REPRESENTATION_REQUEST_APPROVED', 'REPRESENTATION_REQUEST_DECLINED');

-- AlterEnum
BEGIN;
CREATE TYPE "NotificationType_new" AS ENUM ('FOLLOW_UP_ASSIGNED', 'PRIVATE_MESSAGE_RECEIVED', 'RESOURCE_GRANTED', 'ROLE_ASSIGNED', 'FRIEND_REQUEST_RECEIVED', 'FRIEND_REQUEST_ACCEPTED', 'PRAYER_REQUEST_COMMENT', 'PRAYER_REQUEST_SUBMITTED_PRIVATELY', 'ANNOUNCEMENT_PUBLISHED', 'HEADQUARTERS_POST_PUBLISHED', 'AREA_LEADERSHIP_ASSIGNED', 'AREA_REPRESENTATION_REQUEST_DECLINED');
ALTER TABLE "Notification" ALTER COLUMN "type" TYPE "NotificationType_new" USING ("type"::text::"NotificationType_new");
ALTER TYPE "NotificationType" RENAME TO "NotificationType_old";
ALTER TYPE "NotificationType_new" RENAME TO "NotificationType";
DROP TYPE "NotificationType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "RepresentationRequest" DROP CONSTRAINT "RepresentationRequest_decidedByUserId_fkey";

-- DropForeignKey
ALTER TABLE "RepresentationRequest" DROP CONSTRAINT "RepresentationRequest_personId_fkey";

-- DropTable
DROP TABLE "RepresentationRequest";

-- DropEnum
DROP TYPE "RepresentationRequestStatus";
