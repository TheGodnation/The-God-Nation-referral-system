-- A PDF's number of pages, shown on its chat bubble ("71 pages • 3.5 MB • PDF").
ALTER TABLE "MessageAttachment" ADD COLUMN "pageCount" INTEGER;
ALTER TABLE "PrivateMessageAttachment" ADD COLUMN "pageCount" INTEGER;
