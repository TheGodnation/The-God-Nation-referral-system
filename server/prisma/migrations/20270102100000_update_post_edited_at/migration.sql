-- A member can correct the text of their own post; this records when.
ALTER TABLE "UpdatePost" ADD COLUMN "editedAt" TIMESTAMP(3);
