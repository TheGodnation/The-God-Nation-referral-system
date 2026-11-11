-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'LEADERS_NOT_FOLLOWING_UP';

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "leaderAlertSentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CoordinatorContact" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "wellbeingStatus" "WellbeingStatus" NOT NULL DEFAULT 'GOOD',
    "note" TEXT,
    "contactedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoordinatorContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoordinatorContact_personId_contactedAt_idx" ON "CoordinatorContact"("personId", "contactedAt");

-- CreateIndex
CREATE INDEX "CoordinatorContact_adminUserId_contactedAt_idx" ON "CoordinatorContact"("adminUserId", "contactedAt");

-- AddForeignKey
ALTER TABLE "CoordinatorContact" ADD CONSTRAINT "CoordinatorContact_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoordinatorContact" ADD CONSTRAINT "CoordinatorContact_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

