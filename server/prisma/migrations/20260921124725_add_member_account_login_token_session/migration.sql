-- CreateTable
CREATE TABLE "MemberAccount" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "MemberAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberLoginToken" (
    "id" TEXT NOT NULL,
    "memberAccountId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberLoginToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberSession" (
    "id" TEXT NOT NULL,
    "memberAccountId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MemberAccount_personId_key" ON "MemberAccount"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "MemberAccount_email_key" ON "MemberAccount"("email");

-- CreateIndex
CREATE UNIQUE INDEX "MemberLoginToken_tokenHash_key" ON "MemberLoginToken"("tokenHash");

-- CreateIndex
CREATE INDEX "MemberLoginToken_memberAccountId_idx" ON "MemberLoginToken"("memberAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "MemberSession_tokenHash_key" ON "MemberSession"("tokenHash");

-- CreateIndex
CREATE INDEX "MemberSession_memberAccountId_idx" ON "MemberSession"("memberAccountId");

-- CreateIndex
CREATE INDEX "MemberSession_expiresAt_idx" ON "MemberSession"("expiresAt");

-- AddForeignKey
ALTER TABLE "MemberAccount" ADD CONSTRAINT "MemberAccount_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberLoginToken" ADD CONSTRAINT "MemberLoginToken_memberAccountId_fkey" FOREIGN KEY ("memberAccountId") REFERENCES "MemberAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberSession" ADD CONSTRAINT "MemberSession_memberAccountId_fkey" FOREIGN KEY ("memberAccountId") REFERENCES "MemberAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
