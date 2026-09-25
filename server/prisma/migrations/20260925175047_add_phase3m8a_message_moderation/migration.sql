-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedByPersonId" TEXT;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_deletedByPersonId_fkey" FOREIGN KEY ("deletedByPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

