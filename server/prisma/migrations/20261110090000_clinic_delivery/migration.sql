-- Dominion Clinic: a monthly book is sent to members; teachings point to a part of the book.
ALTER TABLE "Teaching" ADD COLUMN "portionBookId" TEXT;
ALTER TABLE "Teaching" ADD COLUMN "portionPage" INTEGER;
ALTER TABLE "Teaching" ADD COLUMN "portionLabel" TEXT;

CREATE TABLE "BookDelivery" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "via" TEXT NOT NULL,
    "sentByPersonId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BookDelivery_personId_bookId_key" ON "BookDelivery"("personId", "bookId");
CREATE INDEX "BookDelivery_bookId_idx" ON "BookDelivery"("bookId");

ALTER TABLE "BookDelivery" ADD CONSTRAINT "BookDelivery_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BookDelivery" ADD CONSTRAINT "BookDelivery_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "LibraryBook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Books that members could already read stay readable: everyone who could see a published
-- monthly book is marked as having been sent it (nobody loses a book they had).
INSERT INTO "BookDelivery" ("id", "personId", "bookId", "via", "createdAt")
SELECT gen_random_uuid()::text, x."personId", x."bookId", 'BACKFILL', CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT cm."personId", b."id" AS "bookId"
  FROM "LibraryBook" b
  JOIN "MonthlyDevotional" d ON d."id" = b."devotionalId" AND d."status" = 'PUBLISHED'
  JOIN "CommunityMembership" cm ON cm."status" = 'ACTIVE' AND (d."communityId" IS NULL OR cm."communityId" = d."communityId")
  WHERE b."kind" = 'DEVOTIONAL'
) x
ON CONFLICT DO NOTHING;
