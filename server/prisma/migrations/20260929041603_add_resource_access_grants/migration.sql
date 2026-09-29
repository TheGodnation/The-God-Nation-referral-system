-- CreateEnum
CREATE TYPE "ResourceAccessGrantStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateTable
CREATE TABLE "Resource" (
    "id" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleFr" TEXT,
    "descriptionEn" TEXT,
    "descriptionFr" TEXT,
    "url" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceAccessGrant" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "status" "ResourceAccessGrantStatus" NOT NULL DEFAULT 'ACTIVE',
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedByUserId" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,

    CONSTRAINT "ResourceAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Resource_active_idx" ON "Resource"("active");

-- CreateIndex
CREATE INDEX "ResourceAccessGrant_personId_status_idx" ON "ResourceAccessGrant"("personId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ResourceAccessGrant_personId_resourceId_key" ON "ResourceAccessGrant"("personId", "resourceId");

-- AddForeignKey
ALTER TABLE "ResourceAccessGrant" ADD CONSTRAINT "ResourceAccessGrant_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceAccessGrant" ADD CONSTRAINT "ResourceAccessGrant_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceAccessGrant" ADD CONSTRAINT "ResourceAccessGrant_grantedByUserId_fkey" FOREIGN KEY ("grantedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceAccessGrant" ADD CONSTRAINT "ResourceAccessGrant_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

