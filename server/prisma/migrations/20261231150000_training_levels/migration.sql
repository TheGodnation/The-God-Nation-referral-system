-- AlterTable
ALTER TABLE "LibraryBook" ADD COLUMN     "trainingLevelId" TEXT;

-- CreateTable
CREATE TABLE "TrainingLevel" (
    "id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleFr" TEXT,
    "summaryEn" TEXT,
    "summaryFr" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingLevel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LibraryBook_trainingLevelId_idx" ON "LibraryBook"("trainingLevelId");

-- AddForeignKey
ALTER TABLE "LibraryBook" ADD CONSTRAINT "LibraryBook_trainingLevelId_fkey" FOREIGN KEY ("trainingLevelId") REFERENCES "TrainingLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- The three levels of the curriculum (the admin can rename, reorder, add and remove levels afterwards), and the books
-- that already exist placed in them by their current numbers: 1-2 Foundations, 3-10 The Kingdom Keys, 11-15 The Rights of
-- Kingdom Citizens. (Kingdom Keys Volume 9 is added later, at number 11, and the Rights books move up by one.)
INSERT INTO "TrainingLevel" ("id", "position", "titleEn", "titleFr", "summaryEn", "summaryFr", "updatedAt") VALUES
  ('level-foundations', 1, 'Level 1: Foundations', 'Niveau 1 : Fondements',
   'Understanding what man was made to be, what was lost, how the Kingdom works, and how a person enters it.',
   'Comprendre ce pour quoi l’homme a été créé, ce qui a été perdu, comment fonctionne le Royaume et comment une personne y entre.', CURRENT_TIMESTAMP),
  ('level-kingdom-keys', 2, 'Level 2: The Kingdom Keys', 'Niveau 2 : Les Clés du Royaume',
   'Understanding and applying the 53 Keys that govern different areas of Kingdom life. The Keys are presented in seven thematic tiers: identity and foundation, access and communication, faith and spiritual operation, authority and dominion, character and conduct, stewardship and Kingdom economy, and community and Kingdom expansion.',
   'Comprendre et appliquer les 53 Clés qui gouvernent les différents domaines de la vie du Royaume. Les Clés sont présentées en sept niveaux thématiques : identité et fondement, accès et communication, foi et fonctionnement spirituel, autorité et domination, caractère et conduite, intendance et économie du Royaume, communauté et expansion du Royaume.', CURRENT_TIMESTAMP),
  ('level-rights', 3, 'Level 3: The Rights of Kingdom Citizens', 'Niveau 3 : Les Droits des citoyens du Royaume',
   'Understanding who you are, what you possess, and what Christ has made available to you. A Kingdom right is something the Bible reveals that a believer already is or has in Christ.',
   'Comprendre qui vous êtes, ce que vous possédez et ce que Christ a mis à votre disposition. Un droit du Royaume est quelque chose que la Bible révèle que le croyant est déjà ou possède déjà en Christ.', CURRENT_TIMESTAMP);

UPDATE "LibraryBook" SET "trainingLevelId" = 'level-foundations' WHERE "kind" = 'TRAINING' AND "trainingOrder" BETWEEN 1 AND 2;
UPDATE "LibraryBook" SET "trainingLevelId" = 'level-kingdom-keys' WHERE "kind" = 'TRAINING' AND "trainingOrder" BETWEEN 3 AND 10;
UPDATE "LibraryBook" SET "trainingLevelId" = 'level-rights' WHERE "kind" = 'TRAINING' AND "trainingOrder" >= 11;
