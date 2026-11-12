-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'MEMBER_NUDGE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ReminderKind" ADD VALUE 'NUDGE_DAY3';
ALTER TYPE "ReminderKind" ADD VALUE 'NUDGE_DAY7';

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "nudgesEnabled" BOOLEAN NOT NULL DEFAULT false;

