-- AlterTable
ALTER TABLE "MemberLoginToken" ADD COLUMN "codeHash" TEXT,
ADD COLUMN "codeAttempts" INTEGER NOT NULL DEFAULT 0;
