-- AlterTable
ALTER TABLE "Community" ADD COLUMN     "autoPlacementEligible" BOOLEAN NOT NULL DEFAULT true;

-- Data backfill: replicate today's ACTUAL open-group behavior exactly, so
-- this migration changes nothing about which existing groups receive new
-- joiners. Before this migration, lib/placement.ts's findOpenGroups treated
-- "has an ACTIVE child" as disqualifying — any Community that is the
-- parentId of at least one ACTIVE child loses eligibility here too. Every
-- other existing Community keeps the column's own default (true).
UPDATE "Community"
SET "autoPlacementEligible" = false
WHERE EXISTS (
  SELECT 1 FROM "Community" child
  WHERE child."parentId" = "Community"."id" AND child."active" = true
);
