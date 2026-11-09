-- Section C (the personal questions) is the same in every question set of an exam:
-- the founder's decision. Book 1's sets 2 and 3 were loaded with their own personal
-- questions; they now take over Set 1's, word for word (English and French, the
-- choices and what each counts as, and the teacher's guide).
-- Only while the exam is still a draft and nobody has taken it, so no recorded
-- answer is ever touched.
DO $fix$
DECLARE
  a_id TEXT;
  src RECORD;
  new_id TEXT;
  s INTEGER;
BEGIN
  SELECT e."id" INTO a_id
  FROM "Assessment" e
  JOIN "LibraryBook" b ON b."id" = e."trainingBookId"
  WHERE b."kind" = 'TRAINING' AND b."trainingOrder" = 1 AND e."status" = 'DRAFT';
  IF a_id IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "PersonalQuestion" WHERE "assessmentId" = a_id AND "setNumber" = 1) THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM "Attempt" WHERE "assessmentId" = a_id) THEN
    RETURN;
  END IF;

  FOREACH s IN ARRAY ARRAY[2, 3]
  LOOP
    IF EXISTS (SELECT 1 FROM "Question" WHERE "assessmentId" = a_id AND "setNumber" = s) THEN
      DELETE FROM "PersonalQuestion" WHERE "assessmentId" = a_id AND "setNumber" = s;
      FOR src IN SELECT * FROM "PersonalQuestion" WHERE "assessmentId" = a_id AND "setNumber" = 1 ORDER BY "order"
      LOOP
        new_id := gen_random_uuid()::text;
        INSERT INTO "PersonalQuestion" ("id", "assessmentId", "setNumber", "order", "kind", "textEn", "textFr", "bodyEn", "bodyFr", "guideEn", "guideFr", "required", "flagUnlessNone", "affectsStatus")
        VALUES (new_id, a_id, s, src."order", src."kind", src."textEn", src."textFr", src."bodyEn", src."bodyFr", src."guideEn", src."guideFr", src."required", src."flagUnlessNone", src."affectsStatus");
        INSERT INTO "PersonalOption" ("id", "questionId", "order", "textEn", "textFr", "signal")
        SELECT gen_random_uuid()::text, new_id, o."order", o."textEn", o."textFr", o."signal"
        FROM "PersonalOption" o
        WHERE o."questionId" = src."id";
      END LOOP;
    END IF;
  END LOOP;
END
$fix$;
