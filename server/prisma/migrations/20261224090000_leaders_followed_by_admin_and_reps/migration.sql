-- Leaders are followed up only by the central admin and the generation representatives, never by other leaders.
-- Closes any active follow-up whose followed person leads an assembly or a group when the follower is neither the
-- central admin nor a current representative. Nothing is deleted: the history stays and the follow-up is only closed.
UPDATE "FollowUpAssignment"
SET "status" = 'CLOSED', "closedAt" = now(), "closeReason" = 'Leaders are followed up by the central admin and the representatives'
WHERE "status" = 'ACTIVE'
  AND "followedPersonId" IN (SELECT "personId" FROM "RoleAssignment" WHERE "roleType" = 'SCOPED_LEADER' AND "status" = 'ACTIVE')
  AND "followerId" NOT IN (SELECT "personId" FROM "User" WHERE "role" = 'ADMIN' AND "personId" IS NOT NULL)
  AND "followerId" NOT IN (SELECT "personId" FROM "GenerationRepresentative" WHERE "endedAt" IS NULL);
