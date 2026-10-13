-- CreateEnum
CREATE TYPE "HeadquartersPostMediaType" AS ENUM ('IMAGE', 'VIDEO', 'AUDIO', 'PDF');

-- CreateTable
CREATE TABLE "HeadquartersPostMedia" (
    "id" TEXT NOT NULL,
    "headquartersPostId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "mediaType" "HeadquartersPostMediaType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HeadquartersPostMedia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HeadquartersPostMedia_headquartersPostId_key" ON "HeadquartersPostMedia"("headquartersPostId");

-- CreateIndex
CREATE UNIQUE INDEX "HeadquartersPostMedia_storageKey_key" ON "HeadquartersPostMedia"("storageKey");

-- AddForeignKey
ALTER TABLE "HeadquartersPostMedia" ADD CONSTRAINT "HeadquartersPostMedia_headquartersPostId_fkey" FOREIGN KEY ("headquartersPostId") REFERENCES "HeadquartersPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
