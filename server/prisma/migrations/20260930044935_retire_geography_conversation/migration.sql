-- DropForeignKey
ALTER TABLE "GeographyConversation" DROP CONSTRAINT "GeographyConversation_geographyId_fkey";

-- DropForeignKey
ALTER TABLE "GeographyConversationRead" DROP CONSTRAINT "GeographyConversationRead_conversationId_fkey";

-- DropForeignKey
ALTER TABLE "GeographyConversationRead" DROP CONSTRAINT "GeographyConversationRead_personId_fkey";

-- DropForeignKey
ALTER TABLE "GeographyMessage" DROP CONSTRAINT "GeographyMessage_conversationId_fkey";

-- DropForeignKey
ALTER TABLE "GeographyMessage" DROP CONSTRAINT "GeographyMessage_senderPersonId_fkey";

-- DropTable
DROP TABLE "GeographyConversation";

-- DropTable
DROP TABLE "GeographyConversationRead";

-- DropTable
DROP TABLE "GeographyMessage";

