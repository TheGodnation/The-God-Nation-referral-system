-- CreateEnum
CREATE TYPE "BookCoverSource" AS ENUM ('AUTO', 'MANUAL');

-- AlterTable
ALTER TABLE "LibraryBook" ADD COLUMN     "coverVersion" TEXT,
ADD COLUMN     "pageCount" INTEGER;

-- CreateTable
CREATE TABLE "LibraryBookCover" (
    "bookId" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "source" "BookCoverSource" NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibraryBookCover_pkey" PRIMARY KEY ("bookId")
);

-- CreateTable
CREATE TABLE "BookChapter" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleFr" TEXT,
    "summaryEn" TEXT,
    "summaryFr" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookChapter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookChapter_bookId_order_idx" ON "BookChapter"("bookId", "order");

-- AddForeignKey
ALTER TABLE "LibraryBookCover" ADD CONSTRAINT "LibraryBookCover_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "LibraryBook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookChapter" ADD CONSTRAINT "BookChapter_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "LibraryBook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

