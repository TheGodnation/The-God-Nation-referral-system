-- When the "continue on the website" email went to someone the central admin approved to start the Leadership School.
ALTER TABLE "TrainingEnrollment" ADD COLUMN "websiteInvitedAt" TIMESTAMP(3);
