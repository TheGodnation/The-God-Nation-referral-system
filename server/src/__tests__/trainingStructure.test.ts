import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';
import { insertBook, moveBook, moveBookToLevel, moveLevel, removeBook, type StructGroup } from '../lib/trainingStructure';

// The curriculum: levels, and books in order. A book's number is its place across all levels, so the admin moves books
// around and adds books in between, and every number (and each exam's title) follows. Nothing else changes: exams, covers,
// payments and "already opened" belong to the book itself.
const app = createApp();
let n = 0;

async function admin() {
  n += 1;
  const email = `struct-admin-${n}@test.local`;
  await createAdmin(email, 'AdminPass123!');
  const agent = request.agent(app);
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'AdminPass123!' });
  return { agent, csrf };
}
type A = Awaited<ReturnType<typeof admin>>;
const post = (a: A, path: string, body: Record<string, unknown> = {}) => a.agent.post(path).set('X-CSRF-Token', a.csrf).send(body);
const patch = (a: A, path: string, body: Record<string, unknown> = {}) => a.agent.patch(path).set('X-CSRF-Token', a.csrf).send(body);
const del = (a: A, path: string) => a.agent.delete(path).set('X-CSRF-Token', a.csrf).send({});

const structure = async (a: A) => (await a.agent.get('/api/admin/library/training/structure')).body as { levels: { id: string; position: number; titleEn: string; books: { id: string; titleEn: string; trainingOrder: number }[] }[]; unplaced: any[] };
const titles = (s: Awaited<ReturnType<typeof structure>>) => s.levels.map((l) => l.books.map((b) => b.titleEn));
const numbers = (s: Awaited<ReturnType<typeof structure>>) => s.levels.flatMap((l) => l.books.map((b) => b.trainingOrder));

async function twoLevels(a: A) {
  const l1 = (await post(a, '/api/admin/library/training/levels', { titleEn: 'Foundations', titleFr: 'Fondements' })).body.id as string;
  const l2 = (await post(a, '/api/admin/library/training/levels', { titleEn: 'Keys' })).body.id as string;
  return { l1, l2 };
}
const addBook = async (a: A, titleEn: string, extra: Record<string, unknown> = {}) => {
  const res = await post(a, '/api/admin/library/books', { kind: 'TRAINING', titleEn, titleFr: `${titleEn} FR`, ...extra });
  expect(res.status).toBe(201);
  return res.body as { id: string; trainingOrder: number };
};

describe('Arranging books (pure steps)', () => {
  const book = (id: string) => ({ id, titleEn: id, titleFr: null, trainingOrder: null });
  const groups: StructGroup[] = [
    { levelId: 'L1', books: [book('a'), book('b')] },
    { levelId: 'L2', books: [book('c'), book('d')] },
    { levelId: null, books: [] },
  ];
  const ids = (g: StructGroup[]) => g.map((x) => x.books.map((b) => b.id).join(''));

  it('moves a book up or down, and across the edge of a level into the next one', () => {
    expect(ids(moveBook(groups, 'b', 'up'))).toEqual(['ba', 'cd', '']);
    expect(ids(moveBook(groups, 'b', 'down'))).toEqual(['a', 'bcd', '']);
    expect(ids(moveBook(groups, 'c', 'up'))).toEqual(['abc', 'd', '']);
    expect(ids(moveBook(groups, 'a', 'up'))).toEqual(['ab', 'cd', '']); // nothing before it
  });

  it('puts a book in a level at a place, or last', () => {
    expect(ids(moveBookToLevel(groups, 'a', 'L2', 2))).toEqual(['b', 'cad', '']);
    expect(ids(moveBookToLevel(groups, 'a', 'L2'))).toEqual(['b', 'cda', '']);
  });

  it('moves a level with its books, and inserts a book at a number or at the end of a level', () => {
    expect(ids(moveLevel(groups, 'L2', 'up'))).toEqual(['cd', 'ab', '']);
    expect(ids(insertBook(groups, book('x'), { number: 3 }))).toEqual(['ab', 'xcd', '']);
    expect(ids(insertBook(groups, book('x'), { levelId: 'L1' }))).toEqual(['abx', 'cd', '']);
    expect(ids(insertBook(groups, book('x'), {}))).toEqual(['ab', 'cdx', '']);
    expect(ids(removeBook(groups, 'a'))).toEqual(['b', 'cd', '']);
  });
});

describe('The curriculum organizer (admin)', () => {
  it('numbers books by their place across the levels, and adds a book in between: the others move down and the exam titles follow', async () => {
    const a = await admin();
    const { l1, l2 } = await twoLevels(a);
    await addBook(a, 'One', { levelId: l1 });
    await addBook(a, 'Two', { levelId: l1 });
    await addBook(a, 'Three', { levelId: l2 });
    await addBook(a, 'Four', { levelId: l2 });
    let s = await structure(a);
    expect(titles(s)).toEqual([['One', 'Two'], ['Three', 'Four']]);
    expect(numbers(s)).toEqual([1, 2, 3, 4]);

    // A new book at number 3 goes in front of "Three"; "Three" and "Four" become 4 and 5.
    const inserted = await addBook(a, 'Between', { trainingOrder: 3 });
    expect(inserted.trainingOrder).toBe(3);
    s = await structure(a);
    expect(titles(s)).toEqual([['One', 'Two'], ['Between', 'Three', 'Four']]);
    expect(numbers(s)).toEqual([1, 2, 3, 4, 5]);

    const exam = await prisma.assessment.findFirstOrThrow({ where: { trainingBook: { titleEn: 'Four' } } });
    expect(exam.titleEn).toBe('Book 5 exam: Four');
    expect(exam.titleFr).toBe('Examen du livre 5 : Four FR');
    const between = await prisma.assessment.findFirstOrThrow({ where: { trainingBook: { titleEn: 'Between' } } });
    expect(between.titleEn).toBe('Book 3 exam: Between');
  });

  it('moves a book up, down, or into another level; the exam and everything else stay with the book', async () => {
    const a = await admin();
    const { l1, l2 } = await twoLevels(a);
    const b1 = await addBook(a, 'One', { levelId: l1 });
    const b2 = await addBook(a, 'Two', { levelId: l1 });
    const b3 = await addBook(a, 'Three', { levelId: l2 });
    const examOfTwo = await prisma.assessment.findFirstOrThrow({ where: { trainingBookId: b2.id } });

    let s = (await post(a, `/api/admin/library/training/books/${b2.id}/move`, { direction: 'up' })).body;
    expect(titles(s)).toEqual([['Two', 'One'], ['Three']]);
    // Down from the end of a level crosses into the next one.
    s = (await post(a, `/api/admin/library/training/books/${b1.id}/move`, { direction: 'down' })).body;
    expect(titles(s)).toEqual([['Two'], ['One', 'Three']]);
    s = (await post(a, `/api/admin/library/training/books/${b3.id}/level`, { levelId: l1, position: 1 })).body;
    expect(titles(s)).toEqual([['Three', 'Two'], ['One']]);
    expect(numbers(s)).toEqual([1, 2, 3]);

    // Book Two is now number 2; its own exam is the same exam, with the new number in its title.
    const exam = await prisma.assessment.findUniqueOrThrow({ where: { id: examOfTwo.id } });
    expect(exam.trainingBookId).toBe(b2.id);
    expect(exam.titleEn).toBe('Book 2 exam: Two');
  });

  it('reorders levels with their books, edits a level, and removes a level only when it is empty', async () => {
    const a = await admin();
    const { l1, l2 } = await twoLevels(a);
    const b1 = await addBook(a, 'One', { levelId: l1 });
    await addBook(a, 'Two', { levelId: l2 });

    let s = (await post(a, `/api/admin/library/training/levels/${l2}/move`, { direction: 'up' })).body;
    expect(s.levels.map((l: any) => l.titleEn)).toEqual(['Keys', 'Foundations']);
    expect(numbers(s)).toEqual([1, 2]);
    expect(titles(s)).toEqual([['Two'], ['One']]);

    expect((await patch(a, `/api/admin/library/training/levels/${l1}`, { titleEn: 'Basics', summaryEn: 'Start here' })).status).toBe(200);
    s = await structure(a);
    expect(s.levels.find((l) => l.id === l1)).toMatchObject({ titleEn: 'Basics' });

    const blocked = await del(a, `/api/admin/library/training/levels/${l1}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('LEVEL_NOT_EMPTY');
    await post(a, `/api/admin/library/training/books/${b1.id}/level`, { levelId: l2 });
    expect((await del(a, `/api/admin/library/training/levels/${l1}`)).status).toBe(200);
    s = await structure(a);
    expect(s.levels).toHaveLength(1);
    expect(numbers(s)).toEqual([1, 2]);
  });

  it('keeps who has opened which book: opened books stay open and the next opens by the new order', async () => {
    const a = await admin();
    const { l1 } = await twoLevels(a);
    const b1 = await addBook(a, 'One', { levelId: l1 });
    const b2 = await addBook(a, 'Two', { levelId: l1 });
    const person = await prisma.person.create({ data: { name: 'Student', whatsappNumber: '+237655009001' } });
    await prisma.trainingEnrollment.create({ data: { personId: person.id, status: 'ACTIVE', activatedAt: new Date() } });
    await prisma.trainingBookOpen.create({ data: { personId: person.id, bookId: b2.id } });
    // A new book goes in front of Two.
    await addBook(a, 'Inserted', { trainingOrder: 2 });
    const { getTrainingBooksFor } = await import('../lib/examWorld');
    const books = await getTrainingBooksFor(person.id);
    expect(books.map((b) => [b.titleEn, b.trainingOrder, b.unlocked])).toEqual([
      ['One', 1, true],
      ['Inserted', 2, false], // One is not passed yet
      ['Two', 3, true], // it was opened before, so it stays open
    ]);
    expect(books.find((b) => b.id === b1.id)?.unlocked).toBe(true);
  });

  it('is for the central admin only, and refuses bad moves', async () => {
    const agent = request.agent(app);
    await bootstrap(agent as any);
    expect((await agent.get('/api/admin/library/training/structure')).status).toBe(401);
    const a = await admin();
    expect((await post(a, '/api/admin/library/training/books/nope/move', { direction: 'up' })).status).toBe(404);
    expect((await post(a, '/api/admin/library/training/books/nope/move', { direction: 'sideways' })).status).toBe(400);
    expect((await post(a, '/api/admin/library/books', { kind: 'TRAINING', titleEn: 'X', levelId: 'missing-level' })).status).toBe(400);
  });
});

describe('The curriculum introduction', () => {
  it('starts as the standard text (English and French), with its markers, and can be replaced and put back', async () => {
    const a = await admin();
    let intro = (await a.agent.get('/api/admin/library/training/intro')).body;
    expect(intro.customEn).toBe(false);
    expect(intro.en).toContain('The Diploma at a Glance');
    expect(intro.en).toContain('[[books]]');
    expect(intro.en).toContain('@web ');
    expect(intro.en).toContain('{{books}}');
    expect(intro.en).not.toMatch(/three attempts|Final Details/i);
    expect(intro.fr).toContain('Présentation du diplôme');
    expect(intro.fr).toContain('[[books]]');
    expect(intro.defaultEn).toBe(intro.en);

    const put = await a.agent.put('/api/admin/library/training/intro').set('X-CSRF-Token', a.csrf).send({ en: '# My own\n[[books]]', fr: '' });
    expect(put.status).toBe(200);
    intro = (await a.agent.get('/api/admin/library/training/intro')).body;
    expect(intro).toMatchObject({ en: '# My own\n[[books]]', customEn: true, customFr: false });
    expect(intro.fr).toContain('Présentation du diplôme');

    // Empty text puts the standard introduction back.
    await a.agent.put('/api/admin/library/training/intro').set('X-CSRF-Token', a.csrf).send({ en: '   ' });
    intro = (await a.agent.get('/api/admin/library/training/intro')).body;
    expect(intro.customEn).toBe(false);
    expect(intro.en).toContain('The Diploma at a Glance');
  });

  it('is for the central admin only', async () => {
    const agent = request.agent(app);
    await bootstrap(agent as any);
    expect((await agent.get('/api/admin/library/training/intro')).status).toBe(401);
  });
});
