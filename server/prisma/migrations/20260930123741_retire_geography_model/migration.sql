-- Final Geography Retirement: removes the Geography model itself — the last
-- remaining Geography dependency after Steps 2, 4, 5A, and 5B already
-- retired GeographyConversation, AnnouncementTarget.geographyId,
-- FollowUpAssignment's GEOGRAPHY context, GeographicAssignment, and
-- RoleAssignment.geographyId. Pre-migration verification (dev and test
-- databases) confirmed zero Geography rows and confirmed, via direct \d
-- inspection, that Geography_parentId_fkey (its own self-referencing tree)
-- is the only foreign key referencing this table. The final organizational
-- model is Central Authority -> Communities -> Members, with no geographic
-- hierarchy of any kind. Person.locationCountry/locationCity/locationArea
-- are untouched by this migration.

-- DropForeignKey
ALTER TABLE "Geography" DROP CONSTRAINT "Geography_parentId_fkey";

-- DropTable
DROP TABLE "Geography";
