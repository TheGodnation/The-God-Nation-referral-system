-- Reminder emails to members: settings (off by default), and the log of what was sent.
-- CreateEnum
CREATE TYPE "ReminderKind" AS ENUM ('FINISH_SIGNUP_1', 'FINISH_SIGNUP_2', 'FINISH_PROFILE', 'WINBACK');

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "reminderDailyCap" INTEGER NOT NULL DEFAULT 40,
ADD COLUMN     "reminderQuietDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "remindersEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "MemberReminder" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "kind" "ReminderKind" NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MemberReminder_personId_kind_sentAt_idx" ON "MemberReminder"("personId", "kind", "sentAt");

-- CreateIndex
CREATE INDEX "MemberReminder_sentAt_idx" ON "MemberReminder"("sentAt");

-- AddForeignKey
ALTER TABLE "MemberReminder" ADD CONSTRAINT "MemberReminder_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

