-- CreateTable
CREATE TABLE "TeachingRatingCard" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeachingRatingCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeachingRatingCard_messageId_key" ON "TeachingRatingCard"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "TeachingRatingCard_teacherId_weekStart_key" ON "TeachingRatingCard"("teacherId", "weekStart");
