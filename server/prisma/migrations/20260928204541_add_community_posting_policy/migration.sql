-- CreateEnum
CREATE TYPE "CommunityPostingPolicy" AS ENUM ('EVERYONE', 'LEADERS_ONLY');

-- AlterTable
ALTER TABLE "Community" ADD COLUMN     "postingPolicy" "CommunityPostingPolicy" NOT NULL DEFAULT 'EVERYONE';

