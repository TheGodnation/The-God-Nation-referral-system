-- The central admin can read leader-to-person follow-up chats (read-only); on by default, he can switch it off.
ALTER TABLE "Settings" ADD COLUMN "adminReadsFollowUpChats" BOOLEAN NOT NULL DEFAULT true;
