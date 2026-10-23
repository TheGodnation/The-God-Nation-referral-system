-- DropIndex
DROP INDEX "HeadquartersPostMedia_headquartersPostId_key";

-- AlterTable
ALTER TABLE "HeadquartersPostMedia" ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "chatWallpaperPreset" TEXT,
ADD COLUMN     "chatWallpaperStorageKey" TEXT,
ADD COLUMN     "chatWallpaperUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "homeWallpaperPreset" TEXT,
ADD COLUMN     "homeWallpaperStorageKey" TEXT,
ADD COLUMN     "homeWallpaperUpdatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "HeadquartersPostMedia_headquartersPostId_position_idx" ON "HeadquartersPostMedia"("headquartersPostId", "position");
