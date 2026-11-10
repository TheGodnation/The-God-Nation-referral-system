-- The ministry's Messenger group invite link, given by the founder. It only fills the link when nothing is set
-- yet, and never runs again, so he can change or clear it in Admin > Settings.
INSERT INTO "Settings" ("id", "messengerUrl", "updatedAt")
VALUES ('singleton', $link$https://m.me/cm/XUfh72ItKNKVb_yB/?send_source=cm%3Acopy_invite_link$link$, now())
ON CONFLICT ("id") DO UPDATE SET "messengerUrl" = EXCLUDED."messengerUrl"
WHERE "Settings"."messengerUrl" IS NULL OR "Settings"."messengerUrl" = '';
