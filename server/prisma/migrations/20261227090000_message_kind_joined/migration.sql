-- CreateEnum
CREATE TYPE "MessageKind" AS ENUM ('USER', 'JOINED');

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "kind" "MessageKind" NOT NULL DEFAULT 'USER';
