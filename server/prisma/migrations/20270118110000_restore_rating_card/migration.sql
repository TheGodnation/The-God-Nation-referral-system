-- One-time repair, asked for by the founder: the rating card of the last teaching in the group where today's teaching took place
-- (25 November 2026) was removed, so nobody could rate it. Only that group's most recent rating card is brought back, and only if it
-- was removed in the last few days; nothing else is touched. Ratings already given were never deleted, so they show again with it.
UPDATE "Message" SET "deletedAt" = NULL, "deletedByPersonId" = NULL
WHERE "id" = (
  SELECT m."id"
  FROM "Message" m
  JOIN "Conversation" c ON c."id" = m."conversationId"
  WHERE c."communityId" = '1237221c-9c61-457b-bbf2-c296442c25e9'
    AND m."kind" = 'TEACHING_RATING'
  ORDER BY m."createdAt" DESC
  LIMIT 1
)
AND "deletedAt" IS NOT NULL
AND "deletedAt" > TIMESTAMP '2026-11-22 00:00:00';
