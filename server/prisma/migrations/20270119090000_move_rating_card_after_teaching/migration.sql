-- One-time repair, asked for by the founder: the latest rating card in the Leadership Development group went out before the
-- teaching (it posts by itself 25 minutes after the slot starts, and the teacher sent the voice notes later). The card is moved to
-- just after the teaching: right after the last voice note the card's own teacher sent after it, or, if that teacher sent none,
-- after the last voice note anyone sent after it. Only a card from the last three days is touched; ratings stay as they are (they
-- belong to the teacher and week, not to the card's place in the chat). Nothing happens if no voice note came after the card.
WITH card AS (
  SELECT m."id", m."createdAt", m."senderPersonId", m."conversationId"
  FROM "Message" m
  JOIN "Conversation" c ON c."id" = m."conversationId"
  WHERE c."communityId" = '1237221c-9c61-457b-bbf2-c296442c25e9'
    AND m."kind" = 'TEACHING_RATING'
    AND m."deletedAt" IS NULL
    AND m."createdAt" > now() - interval '3 days'
  ORDER BY m."createdAt" DESC
  LIMIT 1
),
last_voice AS (
  SELECT v."createdAt"
  FROM "Message" v, card
  WHERE v."conversationId" = card."conversationId"
    AND v."createdAt" > card."createdAt"
    AND v."deletedAt" IS NULL
    AND v."kind" = 'USER'
    AND EXISTS (SELECT 1 FROM "MessageAttachment" a WHERE a."messageId" = v."id" AND a."mimeType" LIKE 'audio/%')
  ORDER BY (v."senderPersonId" = card."senderPersonId") DESC, v."createdAt" DESC
  LIMIT 1
)
UPDATE "Message"
SET "createdAt" = (SELECT "createdAt" FROM last_voice) + interval '1 second'
WHERE "id" = (SELECT "id" FROM card)
  AND EXISTS (SELECT 1 FROM last_voice);
