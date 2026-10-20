-- AlterTable
ALTER TABLE "PendingMemberSignup" ADD COLUMN     "previousCodeHashes" TEXT[] DEFAULT ARRAY[]::TEXT[];

