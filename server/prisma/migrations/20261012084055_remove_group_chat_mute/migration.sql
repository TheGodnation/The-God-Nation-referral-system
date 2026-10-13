/*
  Warnings:

  - You are about to drop the `GroupChatMute` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "GroupChatMute" DROP CONSTRAINT "GroupChatMute_communityId_fkey";

-- DropForeignKey
ALTER TABLE "GroupChatMute" DROP CONSTRAINT "GroupChatMute_personId_fkey";

-- DropTable
DROP TABLE "GroupChatMute";
