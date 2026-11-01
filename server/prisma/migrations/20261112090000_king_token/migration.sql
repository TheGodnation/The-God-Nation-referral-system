-- King's Token: the start day and the permanent ledger.
ALTER TABLE "Settings" ADD COLUMN "tokensStartAt" TIMESTAMP(3);

CREATE TYPE "TokenKind" AS ENUM ('EARNED', 'BOUGHT');
CREATE TYPE "TokenReason" AS ENUM ('CLINIC_EXAM', 'FOUNDATION_SHARE');

CREATE TABLE "TokenEntry" (
    "id" TEXT NOT NULL,
    "personId" TEXT,
    "kind" "TokenKind" NOT NULL DEFAULT 'EARNED',
    "reason" "TokenReason" NOT NULL,
    "amount" DECIMAL(24,6) NOT NULL,
    "assessmentId" TEXT,
    "attemptId" TEXT,
    "correctAnswers" INTEGER,
    "ratePerAnswer" DECIMAL(12,6),
    "sourceEntryId" TEXT,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TokenEntry_sourceEntryId_key" ON "TokenEntry"("sourceEntryId");
CREATE UNIQUE INDEX "TokenEntry_personId_assessmentId_reason_key" ON "TokenEntry"("personId", "assessmentId", "reason");
CREATE INDEX "TokenEntry_personId_createdAt_idx" ON "TokenEntry"("personId", "createdAt");
CREATE INDEX "TokenEntry_reason_createdAt_idx" ON "TokenEntry"("reason", "createdAt");

ALTER TABLE "TokenEntry" ADD CONSTRAINT "TokenEntry_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
