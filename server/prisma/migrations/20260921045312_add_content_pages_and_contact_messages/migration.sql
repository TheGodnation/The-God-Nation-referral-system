-- CreateEnum
CREATE TYPE "ContentPageType" AS ENUM ('PAGE', 'TEACHING', 'ANNOUNCEMENT');

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "contactEmail" TEXT;

-- CreateTable
CREATE TABLE "ContentPage" (
    "id" TEXT NOT NULL,
    "type" "ContentPageType" NOT NULL DEFAULT 'PAGE',
    "slug" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleFr" TEXT,
    "bodyEn" TEXT NOT NULL,
    "bodyFr" TEXT,
    "mediaUrl" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactMessage" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "language" "Language" NOT NULL DEFAULT 'en',
    "emailSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContentPage_slug_key" ON "ContentPage"("slug");

-- CreateIndex
CREATE INDEX "ContentPage_type_published_order_idx" ON "ContentPage"("type", "published", "order");

-- CreateIndex
CREATE INDEX "ContentPage_published_idx" ON "ContentPage"("published");

-- CreateIndex
CREATE INDEX "ContactMessage_createdAt_idx" ON "ContactMessage"("createdAt");
