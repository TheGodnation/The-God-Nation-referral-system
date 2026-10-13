-- CreateTable
CREATE TABLE "PendingMemberSignup" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "pathway" "Pathway" NOT NULL,
    "language" "Language" NOT NULL DEFAULT 'en',
    "visitorId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "codeAttempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingMemberSignup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PendingMemberSignup_email_key" ON "PendingMemberSignup"("email");

