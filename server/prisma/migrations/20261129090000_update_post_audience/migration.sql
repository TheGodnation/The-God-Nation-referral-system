-- Updates posts can be for everyone or only for the author's friends.
CREATE TYPE "UpdateAudience" AS ENUM ('EVERYONE', 'FRIENDS');
ALTER TABLE "UpdatePost" ADD COLUMN "audience" "UpdateAudience" NOT NULL DEFAULT 'EVERYONE';
