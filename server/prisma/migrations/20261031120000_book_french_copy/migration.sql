-- A leadership / devotional book can have a French PDF next to the English one.
ALTER TABLE "LibraryBook" ADD COLUMN "storageKeyFr" TEXT,
ADD COLUMN "byteSizeFr" INTEGER,
ADD COLUMN "pageCountFr" INTEGER;
