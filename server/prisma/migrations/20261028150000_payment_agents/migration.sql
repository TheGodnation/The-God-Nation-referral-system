-- Payment agents: staff who receive book payments for the ministry and confirm them.
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_ORDER_NEW';
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_ORDER_MESSAGE';

CREATE TYPE "PaymentOrderStatus" AS ENUM ('OPEN', 'CLAIMED', 'CONFIRMED', 'CANCELLED', 'EXPIRED');

CREATE TABLE "PaymentAgent" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "label" TEXT,
    "dailyLimit" INTEGER NOT NULL DEFAULT 20,
    "instructions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentAgent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PaymentAgent_personId_key" ON "PaymentAgent"("personId");
ALTER TABLE "PaymentAgent" ADD CONSTRAINT "PaymentAgent_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PaymentOrder" (
    "id" TEXT NOT NULL,
    "buyerPersonId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "bookId" TEXT,
    "bookNumber" INTEGER,
    "amount" INTEGER NOT NULL,
    "status" "PaymentOrderStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    CONSTRAINT "PaymentOrder_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PaymentOrder_agentId_status_createdAt_idx" ON "PaymentOrder"("agentId", "status", "createdAt");
CREATE INDEX "PaymentOrder_buyerPersonId_bookId_status_idx" ON "PaymentOrder"("buyerPersonId", "bookId", "status");
ALTER TABLE "PaymentOrder" ADD CONSTRAINT "PaymentOrder_buyerPersonId_fkey" FOREIGN KEY ("buyerPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentOrder" ADD CONSTRAINT "PaymentOrder_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "PaymentAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentOrder" ADD CONSTRAINT "PaymentOrder_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "LibraryBook"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PaymentOrderMessage" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "senderPersonId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "proofStorageKey" TEXT,
    "proofMimeType" TEXT,
    "proofByteSize" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentOrderMessage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PaymentOrderMessage_proofStorageKey_key" ON "PaymentOrderMessage"("proofStorageKey");
CREATE INDEX "PaymentOrderMessage_orderId_createdAt_idx" ON "PaymentOrderMessage"("orderId", "createdAt");
ALTER TABLE "PaymentOrderMessage" ADD CONSTRAINT "PaymentOrderMessage_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PaymentOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentOrderMessage" ADD CONSTRAINT "PaymentOrderMessage_senderPersonId_fkey" FOREIGN KEY ("senderPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BookPayment" ADD COLUMN "orderId" TEXT, ADD COLUMN "decidedByPersonId" TEXT;
CREATE INDEX "BookPayment_orderId_idx" ON "BookPayment"("orderId");
ALTER TABLE "BookPayment" ADD CONSTRAINT "BookPayment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PaymentOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
