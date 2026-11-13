-- CreateEnum
CREATE TYPE "CertificateStatus" AS ENUM ('REQUESTED', 'PAID', 'ISSUED', 'DELIVERED', 'CANCELLED');
-- CreateEnum
CREATE TYPE "CertificateDelivery" AS ENUM ('POST', 'EMAIL', 'COLLECT');
-- CreateTable
CREATE TABLE "CertificateRequest" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "nameOnCertificate" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "delivery" "CertificateDelivery" NOT NULL,
    "contactPhone" TEXT,
    "address" TEXT,
    "status" "CertificateStatus" NOT NULL DEFAULT 'REQUESTED',
    "adminNote" TEXT,
    "certificateNumber" TEXT,
    "issuedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "booksPassed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CertificateRequest_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "CertificateRequest_personId_key" ON "CertificateRequest"("personId");
-- CreateIndex
CREATE UNIQUE INDEX "CertificateRequest_certificateNumber_key" ON "CertificateRequest"("certificateNumber");
-- CreateIndex
CREATE INDEX "CertificateRequest_status_idx" ON "CertificateRequest"("status");
-- AddForeignKey
ALTER TABLE "CertificateRequest" ADD CONSTRAINT "CertificateRequest_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
