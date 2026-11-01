-- Follow-up now happens in the normal private chat between a leader and the
-- person (voice notes, photos, files, replies...). Copy what was already said
-- in the old text-only follow-up conversations into those private chats, so
-- nothing is lost. The old tables and rows are left untouched.

-- One private chat per (person, leader) pair that has any old messages.
INSERT INTO "PrivateConversation" ("id", "memberPersonId", "initiatorPersonId", "createdAt")
SELECT gen_random_uuid()::text, a."followedPersonId", a."followerId", MIN(m."createdAt")
FROM "FollowUpMessage" m
JOIN "FollowUpConversation" c ON c."id" = m."conversationId"
JOIN "FollowUpAssignment" a ON a."id" = c."followUpAssignmentId"
GROUP BY a."followedPersonId", a."followerId"
ON CONFLICT ("memberPersonId", "initiatorPersonId") DO NOTHING;

-- The messages themselves, with their original times and senders.
INSERT INTO "PrivateMessage" ("id", "conversationId", "senderPersonId", "body", "createdAt")
SELECT gen_random_uuid()::text, pc."id", m."senderPersonId", m."body", m."createdAt"
FROM "FollowUpMessage" m
JOIN "FollowUpConversation" c ON c."id" = m."conversationId"
JOIN "FollowUpAssignment" a ON a."id" = c."followUpAssignmentId"
JOIN "PrivateConversation" pc ON pc."memberPersonId" = a."followedPersonId" AND pc."initiatorPersonId" = a."followerId";
