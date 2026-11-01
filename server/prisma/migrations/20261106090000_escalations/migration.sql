-- Escalation: a leader's hard question, to the parent assembly's leaders or the central admin.
ALTER TYPE "NotificationType" ADD VALUE 'ESCALATION_RECEIVED';
ALTER TYPE "NotificationType" ADD VALUE 'ESCALATION_ANSWERED';
ALTER TYPE "NotificationType" ADD VALUE 'ESCALATION_BYPASSED';

CREATE TYPE "EscalationLevel" AS ENUM ('PARENT_LEADERS', 'CENTRAL_ADMIN');
CREATE TYPE "EscalationStatus" AS ENUM ('OPEN', 'ANSWERED');

CREATE TABLE "FollowUpEscalation" (
    "id" TEXT NOT NULL,
    "askerPersonId" TEXT NOT NULL,
    "aboutPersonId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "level" "EscalationLevel" NOT NULL,
    "status" "EscalationStatus" NOT NULL DEFAULT 'OPEN',
    "dueAt" TIMESTAMP(3),
    "bypassedAt" TIMESTAMP(3),
    "bypassReason" TEXT,
    "answeredByPersonId" TEXT,
    "answeredByUserId" TEXT,
    "answeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowUpEscalation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FollowUpEscalationMessage" (
    "id" TEXT NOT NULL,
    "escalationId" TEXT NOT NULL,
    "senderPersonId" TEXT,
    "senderUserId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowUpEscalationMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FollowUpEscalation_askerPersonId_createdAt_idx" ON "FollowUpEscalation"("askerPersonId", "createdAt");
CREATE INDEX "FollowUpEscalation_communityId_status_idx" ON "FollowUpEscalation"("communityId", "status");
CREATE INDEX "FollowUpEscalation_status_level_dueAt_idx" ON "FollowUpEscalation"("status", "level", "dueAt");
CREATE INDEX "FollowUpEscalationMessage_escalationId_createdAt_idx" ON "FollowUpEscalationMessage"("escalationId", "createdAt");

ALTER TABLE "FollowUpEscalation" ADD CONSTRAINT "FollowUpEscalation_askerPersonId_fkey" FOREIGN KEY ("askerPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FollowUpEscalation" ADD CONSTRAINT "FollowUpEscalation_aboutPersonId_fkey" FOREIGN KEY ("aboutPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FollowUpEscalationMessage" ADD CONSTRAINT "FollowUpEscalationMessage_escalationId_fkey" FOREIGN KEY ("escalationId") REFERENCES "FollowUpEscalation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
