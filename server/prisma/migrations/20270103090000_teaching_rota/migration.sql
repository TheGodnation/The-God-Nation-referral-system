-- CreateTable
CREATE TABLE "TeachingSettings" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "startDate" TIMESTAMP(3) NOT NULL,
    "frenchChecked" BOOLEAN NOT NULL DEFAULT false,
    "guide" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeachingSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeachingTopic" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "textEn" JSONB NOT NULL,
    "textFr" JSONB,
    "bookWords" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeachingTopic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeachingTeacher" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "personId" TEXT,
    "dayOfWeek" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "startTopic" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeachingTeacher_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeachingTopic_number_key" ON "TeachingTopic"("number");

-- CreateIndex
CREATE UNIQUE INDEX "TeachingTeacher_personId_key" ON "TeachingTeacher"("personId");

-- CreateIndex
CREATE INDEX "TeachingTeacher_active_dayOfWeek_startMinute_idx" ON "TeachingTeacher"("active", "dayOfWeek", "startMinute");
