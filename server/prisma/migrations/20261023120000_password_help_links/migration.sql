-- CreateTable
CREATE TABLE "MemberPasswordHelpLink" (
    "id" TEXT NOT NULL,
    "memberAccountId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberPasswordHelpLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MemberPasswordHelpLink_tokenHash_key" ON "MemberPasswordHelpLink"("tokenHash");

-- CreateIndex
CREATE INDEX "MemberPasswordHelpLink_memberAccountId_idx" ON "MemberPasswordHelpLink"("memberAccountId");

-- AddForeignKey
ALTER TABLE "MemberPasswordHelpLink" ADD CONSTRAINT "MemberPasswordHelpLink_memberAccountId_fkey" FOREIGN KEY ("memberAccountId") REFERENCES "MemberAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

