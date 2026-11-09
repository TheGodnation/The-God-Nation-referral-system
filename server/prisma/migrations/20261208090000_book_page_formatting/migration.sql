-- A book's page: words after the chapter list, the title above the chapter
-- list, and each chapter's small label (Introduction, Chapter One, ...).
ALTER TABLE "LibraryBook" ADD COLUMN "closingEn" TEXT,
ADD COLUMN "closingFr" TEXT,
ADD COLUMN "chaptersHeadingEn" TEXT,
ADD COLUMN "chaptersHeadingFr" TEXT;

ALTER TABLE "BookChapter" ADD COLUMN "labelEn" TEXT,
ADD COLUMN "labelFr" TEXT;
