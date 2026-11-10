-- "Your leader": the person is told who has been assigned to follow them up, once the leader has opened their
-- dashboard (a notification and a first private message). Assignments that already exist are marked as done, so
-- nobody who is already being followed up gets a message out of the blue.
ALTER TYPE "NotificationType" ADD VALUE 'LEADER_ASSIGNED';
ALTER TABLE "FollowUpAssignment" ADD COLUMN "introducedAt" TIMESTAMP(3);
UPDATE "FollowUpAssignment" SET "introducedAt" = "assignedAt";
