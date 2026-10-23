-- Leadership training: book payments (manual now, automatic ready), books opened, and grace.
-- CreateEnum
CREATE TYPE "BookPaymentMethod" AS ENUM ('MANUAL', 'AUTOMATIC');

-- CreateEnum
CREATE TYPE "BookPaymentStatus" AS ENUM ('CLAIMED', 'PENDING', 'CONFIRMED', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "TrainingGraceStatus" AS ENUM ('REQUESTED', 'GRANTED', 'DECLINED');

-- AlterEnum


ALTER TYPE "NotificationType" ADD VALUE 'BOOK_PAYMENT_CONFIRMED';
ALTER TYPE "NotificationType" ADD VALUE 'BOOK_PAYMENT_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'TRAINING_GRACE_GRANTED';
ALTER TYPE "NotificationType" ADD VALUE 'TRAINING_GRACE_DECLINED';

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "trainingBookPrice" INTEGER NOT NULL DEFAULT 1100,
ADD COLUMN     "trainingPaymentInstructionsEn" TEXT,
ADD COLUMN     "trainingPaymentInstructionsFr" TEXT;

-- AlterTable
ALTER TABLE "TrainingEnrollment" ADD COLUMN     "graceBooks" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "TrainingBookOpen" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingBookOpen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookPayment" (
    "id" TEXT NOT NULL,
    "personId" TEXT,
    "bookId" TEXT,
    "bookNumber" INTEGER,
    "amount" INTEGER NOT NULL,
    "method" "BookPaymentMethod" NOT NULL,
    "status" "BookPaymentStatus" NOT NULL,
    "reference" TEXT,
    "payerPhone" TEXT,
    "provider" TEXT,
    "providerRef" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,

    CONSTRAINT "BookPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingGraceRequest" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "books" INTEGER NOT NULL,
    "status" "TrainingGraceStatus" NOT NULL DEFAULT 'REQUESTED',
    "grantedBooks" INTEGER,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,

    CONSTRAINT "TrainingGraceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrainingBookOpen_personId_bookId_key" ON "TrainingBookOpen"("personId", "bookId");

-- CreateIndex
CREATE UNIQUE INDEX "BookPayment_providerRef_key" ON "BookPayment"("providerRef");

-- CreateIndex
CREATE INDEX "BookPayment_personId_bookId_idx" ON "BookPayment"("personId", "bookId");

-- CreateIndex
CREATE INDEX "BookPayment_status_createdAt_idx" ON "BookPayment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TrainingGraceRequest_status_requestedAt_idx" ON "TrainingGraceRequest"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "TrainingGraceRequest_personId_idx" ON "TrainingGraceRequest"("personId");

-- AddForeignKey
ALTER TABLE "TrainingBookOpen" ADD CONSTRAINT "TrainingBookOpen_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingBookOpen" ADD CONSTRAINT "TrainingBookOpen_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "LibraryBook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookPayment" ADD CONSTRAINT "BookPayment_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookPayment" ADD CONSTRAINT "BookPayment_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "LibraryBook"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookPayment" ADD CONSTRAINT "BookPayment_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingGraceRequest" ADD CONSTRAINT "TrainingGraceRequest_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingGraceRequest" ADD CONSTRAINT "TrainingGraceRequest_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

