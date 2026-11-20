-- A rating card could be posted for a teaching "finished" before the first week had started (the "I have finished" button did not
-- look at the start date). Remove only those stray cards that nobody has rated yet; the cards of real weeks are never touched.
DELETE FROM "Message"
WHERE "id" IN (
  SELECT c."messageId" FROM "TeachingRatingCard" c
  JOIN "TeachingSettings" s ON s."id" = 'main'
  WHERE c."weekStart" < s."startDate"
    AND NOT EXISTS (SELECT 1 FROM "TeachingRating" r WHERE r."teacherId" = c."teacherId" AND r."weekStart" = c."weekStart")
);

DELETE FROM "TeachingRatingCard" c
USING "TeachingSettings" s
WHERE s."id" = 'main'
  AND c."weekStart" < s."startDate"
  AND NOT EXISTS (SELECT 1 FROM "TeachingRating" r WHERE r."teacherId" = c."teacherId" AND r."weekStart" = c."weekStart");
