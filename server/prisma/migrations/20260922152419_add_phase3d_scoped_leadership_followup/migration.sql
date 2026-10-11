-- Phase 3D: Scoped Leadership + Member Follow-Up
-- Purely additive: 3 new tables, 5 new enums, new indexes, and one existing
-- index (User_personId_idx) replaced by a unique index on the same column
-- (User.personId), which was empty (all NULL) for every existing row —
-- verified before this migration was written. No existing table's data,
-- columns, or values are altered or dropped.

-- CreateEnum
CREATE TYPE "RoleType" AS ENUM ('SCOPED_LEADER');

-- CreateEnum
CREATE TYPE "RoleAssignmentStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "FollowUpContextType" AS ENUM ('COMMUNITY', 'GEOGRAPHY');

-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "WellbeingStatus" AS ENUM ('GOOD', 'NEEDS_ATTENTION', 'EMERGENCY', 'UNABLE_TO_REACH');

-- DropIndex
DROP INDEX "User_personId_idx";

-- CreateTable
CREATE TABLE "RoleAssignment" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "roleType" "RoleType" NOT NULL,
    "communityId" TEXT,
    "geographyId" TEXT,
    "assignedByUserId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "RoleAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpAssignment" (
    "id" TEXT NOT NULL,
    "followerId" TEXT NOT NULL,
    "followedPersonId" TEXT NOT NULL,
    "contextType" "FollowUpContextType" NOT NULL,
    "contextId" TEXT NOT NULL,
    "assignedByUserId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'ACTIVE',
    "closedAt" TIMESTAMP(3),
    "closedByUserId" TEXT,
    "closeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowUpAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpContact" (
    "id" TEXT NOT NULL,
    "followUpAssignmentId" TEXT NOT NULL,
    "contactedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "wellbeingStatus" "WellbeingStatus" NOT NULL,
    "note" TEXT,
    "nextFollowUpDate" TIMESTAMP(3),
    "loggedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowUpContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoleAssignment_personId_idx" ON "RoleAssignment"("personId");

-- CreateIndex
CREATE INDEX "RoleAssignment_communityId_idx" ON "RoleAssignment"("communityId");

-- CreateIndex
CREATE INDEX "RoleAssignment_geographyId_idx" ON "RoleAssignment"("geographyId");

-- CreateIndex
CREATE INDEX "RoleAssignment_status_idx" ON "RoleAssignment"("status");

-- CreateIndex
CREATE INDEX "RoleAssignment_assignedByUserId_idx" ON "RoleAssignment"("assignedByUserId");

-- CreateIndex
CREATE INDEX "FollowUpAssignment_followerId_idx" ON "FollowUpAssignment"("followerId");

-- CreateIndex
CREATE INDEX "FollowUpAssignment_followedPersonId_idx" ON "FollowUpAssignment"("followedPersonId");

-- CreateIndex
CREATE INDEX "FollowUpAssignment_contextType_contextId_idx" ON "FollowUpAssignment"("contextType", "contextId");

-- CreateIndex
CREATE INDEX "FollowUpAssignment_status_idx" ON "FollowUpAssignment"("status");

-- CreateIndex
CREATE INDEX "FollowUpAssignment_assignedByUserId_idx" ON "FollowUpAssignment"("assignedByUserId");

-- CreateIndex
CREATE INDEX "FollowUpContact_followUpAssignmentId_idx" ON "FollowUpContact"("followUpAssignmentId");

-- CreateIndex
CREATE INDEX "FollowUpContact_contactedAt_idx" ON "FollowUpContact"("contactedAt");

-- CreateIndex
CREATE INDEX "FollowUpContact_loggedByUserId_idx" ON "FollowUpContact"("loggedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "User_personId_key" ON "User"("personId");

-- AddForeignKey
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_geographyId_fkey" FOREIGN KEY ("geographyId") REFERENCES "Geography"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpAssignment" ADD CONSTRAINT "FollowUpAssignment_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpAssignment" ADD CONSTRAINT "FollowUpAssignment_followedPersonId_fkey" FOREIGN KEY ("followedPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpAssignment" ADD CONSTRAINT "FollowUpAssignment_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpAssignment" ADD CONSTRAINT "FollowUpAssignment_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpContact" ADD CONSTRAINT "FollowUpContact_followUpAssignmentId_fkey" FOREIGN KEY ("followUpAssignmentId") REFERENCES "FollowUpAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpContact" ADD CONSTRAINT "FollowUpContact_loggedByUserId_fkey" FOREIGN KEY ("loggedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Manual addition (not expressible in Prisma's schema DSL): scope
-- exclusivity — exactly one of communityId/geographyId must be set, never
-- both, never neither.
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_scope_exclusive_check"
    CHECK (
        ("communityId" IS NOT NULL AND "geographyId" IS NULL)
        OR ("communityId" IS NULL AND "geographyId" IS NOT NULL)
    );

-- Manual addition: no two ACTIVE SCOPED_LEADER assignments for the same
-- Person + Community (partial unique index — historical/ENDED rows are
-- unaffected, so a Person may be re-assigned to the same Community later).
CREATE UNIQUE INDEX "RoleAssignment_active_person_community_key"
    ON "RoleAssignment" ("personId", "communityId")
    WHERE "status" = 'ACTIVE' AND "communityId" IS NOT NULL;

-- Manual addition: same rule for Geography scope.
CREATE UNIQUE INDEX "RoleAssignment_active_person_geography_key"
    ON "RoleAssignment" ("personId", "geographyId")
    WHERE "status" = 'ACTIVE' AND "geographyId" IS NOT NULL;

-- Manual addition: only one ACTIVE follow-up relationship may exist between
-- the same follower and followed Person at a time, regardless of context.
-- Closed historical rows are unaffected and may accumulate freely.
CREATE UNIQUE INDEX "FollowUpAssignment_active_follower_followed_key"
    ON "FollowUpAssignment" ("followerId", "followedPersonId")
    WHERE "status" = 'ACTIVE';
