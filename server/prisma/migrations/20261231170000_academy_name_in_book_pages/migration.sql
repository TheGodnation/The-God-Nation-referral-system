-- The school is called "The God Nation Leadership Academy" (no "Media"): update the byline in the book pages already loaded.
UPDATE "LibraryBook"
SET "descriptionEn" = REPLACE(REPLACE("descriptionEn", 'The God Nation Media & Leadership Academy', 'The God Nation Leadership Academy'), 'The God Nation Media and Leadership Academy', 'The God Nation Leadership Academy'),
    "descriptionFr" = REPLACE(REPLACE("descriptionFr", 'The God Nation Media & Leadership Academy', 'The God Nation Leadership Academy'), 'The God Nation Media and Leadership Academy', 'The God Nation Leadership Academy'),
    "closingEn" = REPLACE(REPLACE("closingEn", 'The God Nation Media & Leadership Academy', 'The God Nation Leadership Academy'), 'The God Nation Media and Leadership Academy', 'The God Nation Leadership Academy'),
    "closingFr" = REPLACE(REPLACE("closingFr", 'The God Nation Media & Leadership Academy', 'The God Nation Leadership Academy'), 'The God Nation Media and Leadership Academy', 'The God Nation Leadership Academy')
WHERE "descriptionEn" LIKE '%Media%Leadership Academy%' OR "descriptionFr" LIKE '%Media%Leadership Academy%'
   OR "closingEn" LIKE '%Media%Leadership Academy%' OR "closingFr" LIKE '%Media%Leadership Academy%';
