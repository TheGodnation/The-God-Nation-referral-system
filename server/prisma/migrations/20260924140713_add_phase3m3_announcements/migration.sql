-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleFr" TEXT,
    "bodyEn" TEXT NOT NULL,
    "bodyFr" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnouncementTarget" (
    "id" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "communityId" TEXT,
    "geographyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnnouncementTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Announcement_publishedAt_archivedAt_idx" ON "Announcement"("publishedAt", "archivedAt");

-- CreateIndex
CREATE INDEX "Announcement_createdAt_idx" ON "Announcement"("createdAt");

-- CreateIndex
CREATE INDEX "AnnouncementTarget_announcementId_idx" ON "AnnouncementTarget"("announcementId");

-- CreateIndex
CREATE INDEX "AnnouncementTarget_communityId_idx" ON "AnnouncementTarget"("communityId");

-- CreateIndex
CREATE INDEX "AnnouncementTarget_geographyId_idx" ON "AnnouncementTarget"("geographyId");

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementTarget" ADD CONSTRAINT "AnnouncementTarget_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementTarget" ADD CONSTRAINT "AnnouncementTarget_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementTarget" ADD CONSTRAINT "AnnouncementTarget_geographyId_fkey" FOREIGN KEY ("geographyId") REFERENCES "Geography"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Manual addition (not expressible in Prisma's schema DSL): target
-- exclusivity — exactly one of communityId/geographyId must be set, never
-- both, never neither. Mirrors RoleAssignment_scope_exclusive_check.
ALTER TABLE "AnnouncementTarget" ADD CONSTRAINT "AnnouncementTarget_scope_exclusive_check"
    CHECK (
        ("communityId" IS NOT NULL AND "geographyId" IS NULL)
        OR ("communityId" IS NULL AND "geographyId" IS NOT NULL)
    );

