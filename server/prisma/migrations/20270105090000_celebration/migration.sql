-- CreateTable
CREATE TABLE "Celebration" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "published" BOOLEAN NOT NULL DEFAULT false,
    "titleEn" TEXT NOT NULL DEFAULT '',
    "titleFr" TEXT NOT NULL DEFAULT '',
    "introEn" TEXT NOT NULL DEFAULT '',
    "introFr" TEXT NOT NULL DEFAULT '',
    "messageEn" TEXT NOT NULL DEFAULT '',
    "messageFr" TEXT NOT NULL DEFAULT '',
    "names" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Celebration_pkey" PRIMARY KEY ("id")
);
