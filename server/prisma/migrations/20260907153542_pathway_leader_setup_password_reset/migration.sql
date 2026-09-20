-- CreateEnum
CREATE TYPE "Pathway" AS ENUM ('TRAINING', 'DISCOVER_GROW');

-- AlterTable
ALTER TABLE "Registration" ADD COLUMN     "email" TEXT,
ADD COLUMN     "pathway" "Pathway" NOT NULL DEFAULT 'TRAINING';

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "content" JSONB,
ADD COLUMN     "facebookUrl" TEXT,
ADD COLUMN     "instagramUrl" TEXT,
ADD COLUMN     "supportWhatsappUrl" TEXT,
ADD COLUMN     "tiktokUrl" TEXT,
ADD COLUMN     "whatsappUrlDiscoverEn" TEXT,
ADD COLUMN     "whatsappUrlDiscoverFr" TEXT,
ADD COLUMN     "youtubeUrl" TEXT;

-- CreateTable
CREATE TABLE "LeaderSetupToken" (
    "id" TEXT NOT NULL,
    "leaderId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaderSetupToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeaderSetupToken_tokenHash_key" ON "LeaderSetupToken"("tokenHash");

-- CreateIndex
CREATE INDEX "LeaderSetupToken_leaderId_idx" ON "LeaderSetupToken"("leaderId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- AddForeignKey
ALTER TABLE "LeaderSetupToken" ADD CONSTRAINT "LeaderSetupToken_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
