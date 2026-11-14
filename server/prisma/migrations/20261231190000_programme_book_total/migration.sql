-- The programme has 16 books, shown to students even while the last one is not on the site yet.
ALTER TABLE "Settings" ADD COLUMN "trainingBooksTotal" INTEGER NOT NULL DEFAULT 16;
