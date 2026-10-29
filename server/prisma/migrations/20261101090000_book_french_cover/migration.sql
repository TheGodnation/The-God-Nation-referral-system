-- A book can have its own French cover picture.
ALTER TABLE "LibraryBook" ADD COLUMN "coverFrVersion" TEXT;

CREATE TABLE "LibraryBookCoverFr" (
    "bookId" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "source" "BookCoverSource" NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibraryBookCoverFr_pkey" PRIMARY KEY ("bookId")
);

ALTER TABLE "LibraryBookCoverFr" ADD CONSTRAINT "LibraryBookCoverFr_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "LibraryBook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
