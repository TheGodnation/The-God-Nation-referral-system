-- When a member accepted the Terms of Use and Privacy Policy at sign-up, and which version.
ALTER TABLE "Person" ADD COLUMN "termsAcceptedAt" TIMESTAMP(3);
ALTER TABLE "Person" ADD COLUMN "termsVersion" TEXT;
