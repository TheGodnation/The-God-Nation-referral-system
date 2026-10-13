-- Updates banner picture, and each group's picture and purpose / vision.
ALTER TABLE "Settings" ADD COLUMN "appBannerStorageKey" TEXT,
  ADD COLUMN "appBannerUpdatedAt" TIMESTAMP(3);
ALTER TABLE "Community" ADD COLUMN "photoStorageKey" TEXT,
  ADD COLUMN "photoUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "aboutEn" TEXT,
  ADD COLUMN "aboutFr" TEXT;
