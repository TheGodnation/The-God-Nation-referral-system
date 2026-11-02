-- Retired features:
--  * the Updates page banner picture (nothing shows it any more)
--  * the old 3-step join wizard's holding table (the live sign-up keeps nothing there)

ALTER TABLE "Settings" DROP COLUMN IF EXISTS "appBannerStorageKey";
ALTER TABLE "Settings" DROP COLUMN IF EXISTS "appBannerUpdatedAt";

DROP TABLE IF EXISTS "PendingMemberSignup";
