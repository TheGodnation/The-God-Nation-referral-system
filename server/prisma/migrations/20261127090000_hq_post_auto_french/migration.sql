-- Headquarters posts: remember when the French was filled in by the automatic translation.
ALTER TABLE "HeadquartersPost" ADD COLUMN "frAutoTranslated" BOOLEAN NOT NULL DEFAULT false;
