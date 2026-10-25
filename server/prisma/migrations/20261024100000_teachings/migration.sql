-- CreateTable
CREATE TABLE "Teaching" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "authorPersonId" TEXT,
    "title" TEXT NOT NULL,
    "text" TEXT,
    "mediaKind" TEXT,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "lastRemindedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Teaching_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeachingProgress" (
    "id" TEXT NOT NULL,
    "teachingId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "textReadAt" TIMESTAMP(3),
    "mediaFraction" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "mediaDoneAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeachingProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Teaching_messageId_key" ON "Teaching"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "Teaching_assessmentId_key" ON "Teaching"("assessmentId");

-- CreateIndex
CREATE INDEX "Teaching_communityId_createdAt_idx" ON "Teaching"("communityId", "createdAt");

-- CreateIndex
CREATE INDEX "TeachingProgress_personId_idx" ON "TeachingProgress"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "TeachingProgress_teachingId_personId_key" ON "TeachingProgress"("teachingId", "personId");

-- AddForeignKey
ALTER TABLE "Teaching" ADD CONSTRAINT "Teaching_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Teaching" ADD CONSTRAINT "Teaching_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Teaching" ADD CONSTRAINT "Teaching_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Teaching" ADD CONSTRAINT "Teaching_authorPersonId_fkey" FOREIGN KEY ("authorPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachingProgress" ADD CONSTRAINT "TeachingProgress_teachingId_fkey" FOREIGN KEY ("teachingId") REFERENCES "Teaching"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachingProgress" ADD CONSTRAINT "TeachingProgress_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

