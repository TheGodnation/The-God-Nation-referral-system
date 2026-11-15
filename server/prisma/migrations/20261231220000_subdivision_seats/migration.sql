-- A subdivision has up to five representatives (seats 1 to 5): the first free seat goes to the next person approved.
ALTER TABLE "AreaLeadershipAssignment" ADD COLUMN "seat" INTEGER;

-- Representatives already in place keep their order: the oldest is the first representative, and so on.
WITH ranked AS (
  SELECT a."id", ROW_NUMBER() OVER (PARTITION BY a."areaId" ORDER BY a."assignedAt", a."id") AS n
  FROM "AreaLeadershipAssignment" a
  JOIN "GeographicArea" g ON g."id" = a."areaId"
  WHERE a."status" = 'ACTIVE' AND g."level" = 'SUBDIVISION'
)
UPDATE "AreaLeadershipAssignment" a SET "seat" = ranked.n FROM ranked WHERE a."id" = ranked."id" AND ranked.n <= 5;

-- Two active representatives never share a seat of the same subdivision.
CREATE UNIQUE INDEX "AreaLeadershipAssignment_active_area_seat_key"
  ON "AreaLeadershipAssignment"("areaId", "seat")
  WHERE "status" = 'ACTIVE' AND "seat" IS NOT NULL;
