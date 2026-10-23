-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "leaderSignupPhrase" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "selfRegistered" BOOLEAN NOT NULL DEFAULT false;
