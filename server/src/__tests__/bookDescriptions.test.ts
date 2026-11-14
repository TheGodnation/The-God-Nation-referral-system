import { describe, it, expect } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';
import { PROGRAMME_DESCRIPTIONS, PROGRAMME_LEVEL_IDS, programmeDescription } from '../lib/programmeDescriptions';

// The short description of each of the programme's 16 books ("After reading this book, you become..."): in place of the
// earlier pitch, chapter summaries and closing words, and ready for the book that is still to be added.
const app = createApp();

describe('The programme descriptions', () => {
  it('has all 16, in order, in English and French', () => {
    expect(PROGRAMME_DESCRIPTIONS.map((d) => d.number)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    const perLevel = (l: 'foundations' | 'keys' | 'rights') => PROGRAMME_DESCRIPTIONS.filter((d) => d.level === l).map((d) => d.rank);
    expect(perLevel('foundations')).toEqual([1, 2]);
    expect(perLevel('keys')).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(perLevel('rights')).toEqual([1, 2, 3, 4, 5]);
    for (const d of PROGRAMME_DESCRIPTIONS) {
      expect(d.en).toMatch(/^_After reading this book, you become .+_\n\n.{200,}/s);
      expect(d.fr).toMatch(/^_Après avoir lu ce livre, vous devenez .+_\n\n.{200,}/s);
    }
    expect(programmeDescription(11)!.en).toContain('spread of God');
    expect(programmeDescription(17)).toBeNull();
  });
});

describe('The migration that puts the descriptions in place', () => {
  it('fills each book by its place in its level, clears the old pitch, closing and chapters, and leaves out the missing Volume 9', async () => {
    const levels = await Promise.all(
      (['foundations', 'keys', 'rights'] as const).map((l, i) => prisma.trainingLevel.create({ data: { id: PROGRAMME_LEVEL_IDS[l], position: i + 1, titleEn: l } })),
    );
    expect(levels).toHaveLength(3);
    // 15 books as on the site today: 2 + 8 Kingdom Keys + 5 Rights.
    const plan: [string, number][] = [['foundations', 2], ['keys', 8], ['rights', 5]];
    let n = 0;
    const ids: string[] = [];
    for (const [l, count] of plan) {
      for (let i = 0; i < count; i += 1) {
        n += 1;
        const b = await prisma.libraryBook.create({
          data: { kind: 'TRAINING', titleEn: `Book ${n}`, trainingOrder: n, trainingLevelId: PROGRAMME_LEVEL_IDS[l as 'foundations'], descriptionEn: 'OLD PITCH', closingEn: 'OLD CLOSING', chaptersHeadingEn: 'OLD HEADING' },
        });
        await prisma.bookChapter.create({ data: { bookId: b.id, order: 1, titleEn: 'Old chapter', summaryEn: 'old summary' } });
        ids.push(b.id);
      }
    }
    // A devotional's book is not part of the programme and is left alone.
    const devotional = await prisma.libraryBook.create({ data: { kind: 'DEVOTIONAL', titleEn: 'Devotional', descriptionEn: 'KEEP ME' } });

    const sql = fs.readFileSync(path.resolve(__dirname, '../../prisma/migrations/20261231200000_book_descriptions/migration.sql'), 'utf8');
    for (const statement of sql.split(';').map((s) => s.trim()).filter(Boolean)) await prisma.$executeRawUnsafe(statement);

    const books = await prisma.libraryBook.findMany({ where: { kind: 'TRAINING' }, orderBy: { trainingOrder: 'asc' } });
    // Books 1-10 are programme books 1-10; the five Rights books on the site are programme books 12-16 (Volume 9 is still to come).
    const programmeNumberOf = (siteNumber: number) => (siteNumber <= 10 ? siteNumber : siteNumber + 1);
    for (const b of books) {
      const d = programmeDescription(programmeNumberOf(b.trainingOrder!))!;
      expect(b.descriptionEn).toBe(d.en);
      expect(b.descriptionFr).toBe(d.fr);
      expect(b.closingEn).toBeNull();
      expect(b.chaptersHeadingEn).toBeNull();
    }
    expect(books.find((b) => b.trainingOrder === 11)!.descriptionEn).toContain('the Rights'.length ? 'lives from what Christ has already finished' : '');
    expect(await prisma.bookChapter.count()).toBe(0);
    expect((await prisma.libraryBook.findUnique({ where: { id: devotional.id } }))!.descriptionEn).toBe('KEEP ME');
    void ids;
  });
});

describe('Adding the missing book', () => {
  it('Kingdom Keys, Volume 9, added at number 11 gets its description at once; a book with its own description keeps it', async () => {
    await createAdmin('desc-admin@test.local', 'AdminPass123!');
    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent as any);
    await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: 'desc-admin@test.local', password: 'AdminPass123!' });
    for (const [i, l] of (['foundations', 'keys', 'rights'] as const).entries()) await prisma.trainingLevel.create({ data: { id: PROGRAMME_LEVEL_IDS[l], position: i + 1, titleEn: l } });
    // Books 1-10 as on the site, in the first two levels, and one Rights book.
    for (let n = 1; n <= 10; n += 1) {
      await prisma.libraryBook.create({ data: { kind: 'TRAINING', titleEn: `Book ${n}`, trainingOrder: n, trainingLevelId: PROGRAMME_LEVEL_IDS[n <= 2 ? 'foundations' : 'keys'] } });
    }
    await prisma.libraryBook.create({ data: { kind: 'TRAINING', titleEn: 'Rights 1', trainingOrder: 11, trainingLevelId: PROGRAMME_LEVEL_IDS.rights } });

    const res = await agent.post('/api/admin/library/books').set('X-CSRF-Token', csrf).send({ kind: 'TRAINING', titleEn: 'Kingdom Keys, Volume 9', titleFr: 'Les Clés du Royaume, volume 9', trainingOrder: 11, levelId: PROGRAMME_LEVEL_IDS.keys });
    expect(res.status).toBe(201);
    expect(res.body.trainingOrder).toBe(11);
    const vol9 = await prisma.libraryBook.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(vol9.descriptionEn).toBe(programmeDescription(11)!.en);
    expect(vol9.descriptionFr).toBe(programmeDescription(11)!.fr);
    // The Rights book moved to 12.
    expect((await prisma.libraryBook.findFirstOrThrow({ where: { titleEn: 'Rights 1' } })).trainingOrder).toBe(12);

    // A book with its own words keeps them.
    const own = await agent.post('/api/admin/library/books').set('X-CSRF-Token', csrf).send({ kind: 'TRAINING', titleEn: 'Extra', descriptionEn: 'My own words.', levelId: PROGRAMME_LEVEL_IDS.rights });
    expect((await prisma.libraryBook.findUniqueOrThrow({ where: { id: own.body.id } })).descriptionEn).toBe('My own words.');
    // And a book added somewhere that is not the programme's place for it gets nothing.
    const other = await agent.post('/api/admin/library/books').set('X-CSRF-Token', csrf).send({ kind: 'TRAINING', titleEn: 'Another', levelId: PROGRAMME_LEVEL_IDS.foundations });
    expect((await prisma.libraryBook.findUniqueOrThrow({ where: { id: other.body.id } })).descriptionEn).toBeNull();
  });
});
