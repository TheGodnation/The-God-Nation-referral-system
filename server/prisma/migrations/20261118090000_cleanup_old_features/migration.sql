-- Clean-up of features that were retired:
--  * the leader-recommendation feature (removed in an earlier phase; nothing reads or writes it now)
--  * the personal WhatsApp contact setting (the Assistance button uses supportWhatsappUrl)
--  * the leader self-sign-up access phrase (leaders are appointed from the member side)

DROP TABLE IF EXISTS "OrganizationalLeadershipRecommendation";
DROP TYPE IF EXISTS "OrganizationalLeadershipRecommendationStatus";

ALTER TABLE "Settings" DROP COLUMN IF EXISTS "whatsappContactUrl";
ALTER TABLE "Settings" DROP COLUMN IF EXISTS "leaderSignupPhrase";
