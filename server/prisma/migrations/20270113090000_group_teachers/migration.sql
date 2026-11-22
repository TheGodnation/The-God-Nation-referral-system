-- CreateTable
CREATE TABLE "GroupTeacher" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupTeacher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeachingDay" (
    "id" TEXT NOT NULL,
    "groupTeacherId" TEXT NOT NULL,
    "dayOfWeek" INTEGER,
    "date" TEXT,
    "startMinute" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeachingDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GroupTeacher_communityId_idx" ON "GroupTeacher"("communityId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupTeacher_personId_communityId_key" ON "GroupTeacher"("personId", "communityId");

-- CreateIndex
CREATE INDEX "TeachingDay_groupTeacherId_idx" ON "TeachingDay"("groupTeacherId");

-- AddForeignKey
ALTER TABLE "TeachingDay" ADD CONSTRAINT "TeachingDay_groupTeacherId_fkey" FOREIGN KEY ("groupTeacherId") REFERENCES "GroupTeacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;
