-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- AlterTable
ALTER TABLE "Registration" ADD COLUMN     "personId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "personId" TEXT;

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "whatsappNumber" TEXT NOT NULL,
    "email" TEXT,
    "preferredLanguage" "Language" NOT NULL DEFAULT 'en',
    "isTestData" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Community" (
    "id" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Community_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityMembership" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Geography" (
    "id" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Geography_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeographicAssignment" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "geographyId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeographicAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Person_whatsappNumber_key" ON "Person"("whatsappNumber");

-- CreateIndex
CREATE INDEX "Person_isTestData_idx" ON "Person"("isTestData");

-- CreateIndex
CREATE INDEX "Community_parentId_idx" ON "Community"("parentId");

-- CreateIndex
CREATE INDEX "Community_active_idx" ON "Community"("active");

-- CreateIndex
CREATE INDEX "CommunityMembership_communityId_idx" ON "CommunityMembership"("communityId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityMembership_personId_communityId_key" ON "CommunityMembership"("personId", "communityId");

-- CreateIndex
CREATE INDEX "Geography_parentId_idx" ON "Geography"("parentId");

-- CreateIndex
CREATE INDEX "Geography_countryCode_parentId_idx" ON "Geography"("countryCode", "parentId");

-- CreateIndex
CREATE INDEX "Geography_active_idx" ON "Geography"("active");

-- CreateIndex
CREATE UNIQUE INDEX "GeographicAssignment_personId_key" ON "GeographicAssignment"("personId");

-- CreateIndex
CREATE INDEX "GeographicAssignment_geographyId_idx" ON "GeographicAssignment"("geographyId");

-- CreateIndex
CREATE INDEX "Registration_personId_idx" ON "Registration"("personId");

-- CreateIndex
CREATE INDEX "User_personId_idx" ON "User"("personId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Community" ADD CONSTRAINT "Community_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Community"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityMembership" ADD CONSTRAINT "CommunityMembership_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityMembership" ADD CONSTRAINT "CommunityMembership_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Geography" ADD CONSTRAINT "Geography_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Geography"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeographicAssignment" ADD CONSTRAINT "GeographicAssignment_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeographicAssignment" ADD CONSTRAINT "GeographicAssignment_geographyId_fkey" FOREIGN KEY ("geographyId") REFERENCES "Geography"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
