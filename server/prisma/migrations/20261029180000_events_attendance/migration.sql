-- Events calendar, attendance sheet and replay credit.
ALTER TYPE "NotificationType" ADD VALUE 'EVENT_NEW';
ALTER TYPE "NotificationType" ADD VALUE 'EVENT_REMINDER';

CREATE TYPE "EventAttendanceMethod" AS ENUM ('LEADER', 'SELF');

CREATE TABLE "AssemblyEvent" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "onlineUrl" TEXT,
    "checkInCode" TEXT NOT NULL,
    "replayTeachingId" TEXT,
    "createdByPersonId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "reminderSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssemblyEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AssemblyEvent_communityId_startsAt_idx" ON "AssemblyEvent"("communityId", "startsAt");
CREATE INDEX "AssemblyEvent_startsAt_reminderSentAt_idx" ON "AssemblyEvent"("startsAt", "reminderSentAt");
ALTER TABLE "AssemblyEvent" ADD CONSTRAINT "AssemblyEvent_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssemblyEvent" ADD CONSTRAINT "AssemblyEvent_replayTeachingId_fkey" FOREIGN KEY ("replayTeachingId") REFERENCES "Teaching"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AssemblyEvent" ADD CONSTRAINT "AssemblyEvent_createdByPersonId_fkey" FOREIGN KEY ("createdByPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "EventRsvp" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventRsvp_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EventRsvp_eventId_personId_key" ON "EventRsvp"("eventId", "personId");
CREATE INDEX "EventRsvp_personId_idx" ON "EventRsvp"("personId");
ALTER TABLE "EventRsvp" ADD CONSTRAINT "EventRsvp_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "AssemblyEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventRsvp" ADD CONSTRAINT "EventRsvp_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EventAttendance" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "method" "EventAttendanceMethod" NOT NULL,
    "markedByPersonId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventAttendance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EventAttendance_eventId_personId_key" ON "EventAttendance"("eventId", "personId");
CREATE INDEX "EventAttendance_personId_idx" ON "EventAttendance"("personId");
ALTER TABLE "EventAttendance" ADD CONSTRAINT "EventAttendance_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "AssemblyEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventAttendance" ADD CONSTRAINT "EventAttendance_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
