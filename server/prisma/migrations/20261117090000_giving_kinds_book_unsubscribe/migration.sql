-- More giving categories, and the choice to stop receiving the monthly Dominion Clinic book.
ALTER TYPE "GiftKind" ADD VALUE 'SEED_FAITH';
ALTER TYPE "GiftKind" ADD VALUE 'THANKSGIVING';
ALTER TYPE "GiftKind" ADD VALUE 'FIRST_FRUITS';
ALTER TYPE "GiftKind" ADD VALUE 'OTHER';

ALTER TABLE "Person" ADD COLUMN "clinicBookUnsubscribedAt" TIMESTAMP(3);
