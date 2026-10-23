-- CreateEnum
CREATE TYPE "GeographicLevel" AS ENUM ('NATIONAL', 'REGION', 'DIVISION', 'SUBDIVISION', 'QUARTER');

-- CreateEnum
CREATE TYPE "AreaLeadershipStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "AreaRepresentationRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'AREA_LEADERSHIP_ASSIGNED';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'AREA_REPRESENTATION_REQUEST_DECLINED';

-- CreateTable
CREATE TABLE "GeographicArea" (
    "id" TEXT NOT NULL,
    "parentId" TEXT,
    "level" "GeographicLevel" NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeographicArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AreaLeadershipAssignment" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "assignedByUserId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "AreaLeadershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AreaLeadershipAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AreaRepresentationRequest" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "note" TEXT,
    "status" "AreaRepresentationRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "decisionNote" TEXT,

    CONSTRAINT "AreaRepresentationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GeographicArea_parentId_idx" ON "GeographicArea"("parentId");

-- CreateIndex
CREATE INDEX "GeographicArea_country_level_idx" ON "GeographicArea"("country", "level");

-- CreateIndex
CREATE INDEX "AreaLeadershipAssignment_personId_idx" ON "AreaLeadershipAssignment"("personId");

-- CreateIndex
CREATE INDEX "AreaLeadershipAssignment_areaId_idx" ON "AreaLeadershipAssignment"("areaId");

-- CreateIndex
CREATE INDEX "AreaLeadershipAssignment_status_idx" ON "AreaLeadershipAssignment"("status");

-- CreateIndex
CREATE INDEX "AreaRepresentationRequest_personId_status_idx" ON "AreaRepresentationRequest"("personId", "status");

-- CreateIndex
CREATE INDEX "AreaRepresentationRequest_areaId_status_idx" ON "AreaRepresentationRequest"("areaId", "status");

-- AddForeignKey
ALTER TABLE "GeographicArea" ADD CONSTRAINT "GeographicArea_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "GeographicArea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AreaLeadershipAssignment" ADD CONSTRAINT "AreaLeadershipAssignment_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AreaLeadershipAssignment" ADD CONSTRAINT "AreaLeadershipAssignment_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "GeographicArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AreaLeadershipAssignment" ADD CONSTRAINT "AreaLeadershipAssignment_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AreaRepresentationRequest" ADD CONSTRAINT "AreaRepresentationRequest_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AreaRepresentationRequest" ADD CONSTRAINT "AreaRepresentationRequest_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "GeographicArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AreaRepresentationRequest" ADD CONSTRAINT "AreaRepresentationRequest_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Manual addition, mirroring RoleAssignment_active_person_community_key:
-- no two ACTIVE AreaLeadershipAssignment rows for the same Person + Area
-- (partial unique index — historical/ENDED rows are unaffected, so a Person
-- may be re-assigned to the same Area later). Multiple DIFFERENT people may
-- still each have an ACTIVE assignment to the same Area (co-leaders) — this
-- only prevents an exact duplicate.
CREATE UNIQUE INDEX "AreaLeadershipAssignment_active_person_area_key"
    ON "AreaLeadershipAssignment" ("personId", "areaId")
    WHERE "status" = 'ACTIVE';
