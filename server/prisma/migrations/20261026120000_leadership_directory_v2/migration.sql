-- A position name the admin can give a person who leads an area.
ALTER TABLE "AreaLeadershipAssignment" ADD COLUMN "title" TEXT;

-- A request to represent a place can name a place that is not on the list yet:
-- the member types it in, and the admin adds the place and approves, or declines.
ALTER TABLE "AreaRepresentationRequest"
  ALTER COLUMN "areaId" DROP NOT NULL,
  ADD COLUMN "typedCountry" TEXT,
  ADD COLUMN "typedRegion" TEXT,
  ADD COLUMN "typedDivision" TEXT,
  ADD COLUMN "typedSubdivision" TEXT,
  ADD COLUMN "typedQuarter" TEXT;

-- The National Team shown at the top of the Leadership Directory.
CREATE TABLE "NationalTeamMember" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "assignedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NationalTeamMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NationalTeamMember_personId_key" ON "NationalTeamMember"("personId");
CREATE INDEX "NationalTeamMember_sortOrder_idx" ON "NationalTeamMember"("sortOrder");

ALTER TABLE "NationalTeamMember" ADD CONSTRAINT "NationalTeamMember_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NationalTeamMember" ADD CONSTRAINT "NationalTeamMember_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
