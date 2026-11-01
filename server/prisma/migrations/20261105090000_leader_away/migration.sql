-- A leader can mark themselves away until a date.
ALTER TABLE "Person" ADD COLUMN "awayUntil" TIMESTAMP(3);
