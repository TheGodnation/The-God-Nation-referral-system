-- The central admin follows up the leaders; leaders never follow up the central admin. Closes any follow-up whose
-- followed person is an admin's own member profile (for example one made by a test assignment). Nothing is deleted:
-- the history stays, and the follow-up is only marked closed.
UPDATE "FollowUpAssignment"
SET "status" = 'CLOSED', "closedAt" = now(), "closeReason" = 'The central admin is not followed up by leaders'
WHERE "status" = 'ACTIVE'
  AND "followedPersonId" IN (SELECT "personId" FROM "User" WHERE "role" = 'ADMIN' AND "personId" IS NOT NULL);
