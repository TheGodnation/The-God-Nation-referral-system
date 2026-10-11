-- Tiny photo previews for slow networks.
ALTER TABLE "MessageAttachment" ADD COLUMN "thumbDataUrl" TEXT;
ALTER TABLE "PrivateMessageAttachment" ADD COLUMN "thumbDataUrl" TEXT;
