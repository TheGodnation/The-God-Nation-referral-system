-- Central admin posts get the same reactions as member posts (older rows stay LIKE).
ALTER TABLE "HeadquartersPostReaction" ADD COLUMN "type" "UpdateReactionType" NOT NULL DEFAULT 'LIKE';
