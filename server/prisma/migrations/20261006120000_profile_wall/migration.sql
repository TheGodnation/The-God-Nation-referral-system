-- Profile wall: cover picture and a short line about the member.
ALTER TABLE "Person" ADD COLUMN "coverStorageKey" TEXT,
  ADD COLUMN "coverUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "bio" TEXT;
