-- Share-into-app: forward posts from WhatsApp, TikTok, Facebook, Instagram
-- into the Updates feed as an official post.
CREATE TYPE "HeadquartersPostVoice" AS ENUM ('CENTRAL_AUTHORITY', 'COMMUNICATION_DEPARTMENT');
CREATE TYPE "SocialLinkProvider" AS ENUM ('YOUTUBE', 'TIKTOK', 'INSTAGRAM', 'FACEBOOK', 'OTHER');

ALTER TABLE "HeadquartersPost"
  ADD COLUMN "voice" "HeadquartersPostVoice" NOT NULL DEFAULT 'CENTRAL_AUTHORITY',
  ADD COLUMN "linkUrl" TEXT,
  ADD COLUMN "linkProvider" "SocialLinkProvider";

ALTER TABLE "Person" ADD COLUMN "canShareIntoApp" BOOLEAN NOT NULL DEFAULT false;
