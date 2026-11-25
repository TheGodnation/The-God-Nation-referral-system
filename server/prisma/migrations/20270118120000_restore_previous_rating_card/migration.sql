-- One-time repair, asked for by the founder: the rating card BEFORE the last one in the same group (see
-- 20270118110000_restore_rating_card) was removed too. It is brought back if it was removed since the teachings began; nothing else
-- is touched. Ratings are kept per teacher and week, not on the card, and were never deleted, so they all show again with it.
UPDATE "Message" SET "deletedAt" = NULL, "deletedByPersonId" = NULL
WHERE "id" = (
  SELECT m."id"
  FROM "Message" m
  JOIN "Conversation" c ON c."id" = m."conversationId"
  WHERE c."communityId" = '1237221c-9c61-457b-bbf2-c296442c25e9'
    AND m."kind" = 'TEACHING_RATING'
  ORDER BY m."createdAt" DESC
  LIMIT 1 OFFSET 1
)
AND "deletedAt" IS NOT NULL
AND "deletedAt" > TIMESTAMP '2026-11-20 00:00:00';
