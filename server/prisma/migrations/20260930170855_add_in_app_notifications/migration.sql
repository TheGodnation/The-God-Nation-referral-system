-- In-App Notifications Foundation — a small, reusable persisted notification
-- for the four initial supported events (Follow-Up assigned, private
-- message received, Resource granted, Community leadership assigned).

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('FOLLOW_UP_ASSIGNED', 'PRIVATE_MESSAGE_RECEIVED', 'RESOURCE_GRANTED', 'ROLE_ASSIGNED');

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "recipientPersonId" TEXT,
    "recipientUserId" TEXT,
    "type" "NotificationType" NOT NULL,
    "metadata" JSONB,
    "targetType" TEXT,
    "targetId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_recipientPersonId_readAt_createdAt_idx" ON "Notification"("recipientPersonId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_recipientUserId_readAt_createdAt_idx" ON "Notification"("recipientUserId", "readAt", "createdAt");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientPersonId_fkey" FOREIGN KEY ("recipientPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- In-App Notifications Foundation — identity-duality exclusivity constraint,
-- mirroring PrivateConversation_initiator_exclusive_check /
-- PrivateMessage_sender_exclusive_check / PrivateConversationRead_reader_exclusive_check:
-- exactly one of the two nullable recipient identity columns must be set,
-- never both, never neither.
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipient_exclusive_check"
    CHECK (
        ("recipientPersonId" IS NOT NULL AND "recipientUserId" IS NULL)
        OR ("recipientPersonId" IS NULL AND "recipientUserId" IS NOT NULL)
    );
