-- The person who reports gets the reviewer's answer.
ALTER TYPE "NotificationType" ADD VALUE 'MEMBER_REPORT_REVIEWED';

ALTER TABLE "MemberReport" ADD COLUMN "outcome" TEXT;
