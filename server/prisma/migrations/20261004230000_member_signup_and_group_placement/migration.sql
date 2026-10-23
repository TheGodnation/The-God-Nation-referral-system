-- CreateEnum
CREATE TYPE "PlacementMode" AS ENUM ('SMALLEST_GROUP', 'BY_LOCATION');

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN "placementMode" "PlacementMode" NOT NULL DEFAULT 'SMALLEST_GROUP';

-- AlterTable
ALTER TABLE "Person" ADD COLUMN "locationRegion" TEXT,
ADD COLUMN "locationDivision" TEXT,
ADD COLUMN "locationSubdivision" TEXT,
ADD COLUMN "locationQuarter" TEXT,
ADD COLUMN "profileCompletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Community" ADD COLUMN "placementCountry" TEXT,
ADD COLUMN "placementRegion" TEXT;

-- Everyone who already exists before this change keeps using the app
-- exactly as before: they are treated as having completed sign-up, so
-- only brand-new sign-ups are asked for the details form.
UPDATE "Person" SET "profileCompletedAt" = "createdAt" WHERE "profileCompletedAt" IS NULL;
