-- CreateTable
CREATE TABLE "TrustedMemberDevice" (
    "id" TEXT NOT NULL,
    "memberAccountId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrustedMemberDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrustedMemberDevice_tokenHash_key" ON "TrustedMemberDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "TrustedMemberDevice_memberAccountId_idx" ON "TrustedMemberDevice"("memberAccountId");

-- AddForeignKey
ALTER TABLE "TrustedMemberDevice" ADD CONSTRAINT "TrustedMemberDevice_memberAccountId_fkey" FOREIGN KEY ("memberAccountId") REFERENCES "MemberAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The central admin's own member profile now carries the admin's powers,
-- so its existing sign-ins end once: the next sign-in on each phone needs
-- the code emailed to it.
DELETE FROM "MemberSession"
WHERE "memberAccountId" IN (
  SELECT ma."id" FROM "MemberAccount" ma
  JOIN "User" u ON u."personId" = ma."personId"
  WHERE u."role" = 'ADMIN'
);
