-- CreateTable
CREATE TABLE "ScheduledTeaching" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "authorPersonId" TEXT NOT NULL,
    "postAt" TIMESTAMP(3) NOT NULL,
    "liveTeaching" BOOLEAN NOT NULL DEFAULT false,
    "status" "TeachingRecordingStatus" NOT NULL DEFAULT 'RECORDED',
    "textEn" TEXT,
    "textFr" TEXT,
    "translatedInto" "Language",
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "approvedAt" TIMESTAMP(3),
    "postedAt" TIMESTAMP(3),
    "messageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledTeaching_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledTeachingClip" (
    "id" TEXT NOT NULL,
    "teachingId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "language" "Language" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "textState" "TeachingPartText" NOT NULL DEFAULT 'WAITING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduledTeachingClip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduledTeaching_status_postAt_idx" ON "ScheduledTeaching"("status", "postAt");

-- CreateIndex
CREATE INDEX "ScheduledTeaching_authorPersonId_idx" ON "ScheduledTeaching"("authorPersonId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledTeachingClip_storageKey_key" ON "ScheduledTeachingClip"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledTeachingClip_teachingId_position_key" ON "ScheduledTeachingClip"("teachingId", "position");

-- AddForeignKey
ALTER TABLE "ScheduledTeachingClip" ADD CONSTRAINT "ScheduledTeachingClip_teachingId_fkey" FOREIGN KEY ("teachingId") REFERENCES "ScheduledTeaching"("id") ON DELETE CASCADE ON UPDATE CASCADE;
