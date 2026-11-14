import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';
import { getTrainingBooksFor } from '../lib/examWorld';
import { certificateEligibility } from '../lib/certificates';
import { readyToLeadIn } from '../lib/cells';

// Leaders who studied on WhatsApp before the app: the central admin records, one person at a time, how many books they
// completed. Those books are open, owe nothing and count as passed; the next book opens so they carry on from there.
const app = createApp();

let n = 0;
async function admin() {
  n += 1;
  const email = `wa-credit-${n}@test.local`;
  const adminUser = await createAdmin(email, 'AdminPass123!');
  const raw = request.agent(app);
  const ip = `10.141.0.${n}`;
  const agent = {
    get: (p: string) => raw.get(p).set('X-Forwarded-For', ip),
    post: (p: string) => raw.post(p).set('X-Forwarded-For', ip),
  };
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'AdminPass123!' });
  return { agent, csrf, adminUser };
}

async function programme(books: number) {
  await prisma.settings.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', trainingBooksTotal: books }, update: { trainingBooksTotal: books } });
  const exams: string[] = [];
  for (let order = 1; order <= books; order += 1) {
    const book = await prisma.libraryBook.create({ data: { kind: 'TRAINING', titleEn: `Book ${order}`, trainingOrder: order } });
    const exam = await prisma.assessment.create({ data: { titleEn: `Exam ${order}`, passMark: 70, status: 'PUBLISHED', trainingBookId: book.id } });
    exams.push(exam.id);
  }
  return exams;
}

async function person(name: string, communityId?: string) {
  n += 1;
  const p = await prisma.person.create({ data: { name: `${name} ${n}`, whatsappNumber: `+2376708${String(n).padStart(5, '0')}`, preferredLanguage: 'en' } });
  if (communityId) await prisma.communityMembership.create({ data: { personId: p.id, communityId, status: 'ACTIVE' } });
  return p;
}

describe('Books completed on WhatsApp', () => {
  it('opens the first N books, owes nothing on them, and opens the next one', async () => {
    await programme(4);
    const { agent, csrf } = await admin();
    const p = await person('Leader');

    const view = await agent.get(`/api/admin/library/trainees/${p.id}/credit`);
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ enrolled: false, booksCredited: 0, totalBooks: 4 });

    const res = await agent.post(`/api/admin/library/trainees/${p.id}/credit`).set('X-CSRF-Token', csrf).send({ books: 2 });
    expect(res.status).toBe(200);
    expect(res.body.booksCredited).toBe(2);

    const books = await getTrainingBooksFor(p.id);
    expect(books.map((b) => ({ n: b.trainingOrder, open: b.unlocked, credited: b.credited, passed: b.exam?.passed, pay: b.payment }))).toEqual([
      { n: 1, open: true, credited: true, passed: true, pay: 'PAID' },
      { n: 2, open: true, credited: true, passed: true, pay: 'PAID' },
      { n: 3, open: true, credited: false, passed: false, pay: null },
      { n: 4, open: false, credited: false, passed: false, pay: null },
    ]);
    // Only the book they carry on with can be owed; the credited ones were never "opened and unpaid".
    const opens = await prisma.trainingBookOpen.findMany({ where: { personId: p.id }, include: { book: true } });
    expect(opens.map((o) => o.book.trainingOrder)).toEqual([3]);
    expect((await prisma.trainingEnrollment.findUnique({ where: { personId: p.id } }))?.status).toBe('ACTIVE');
  });

  it('counts for the certificate and for "ready to lead" once every book is done', async () => {
    await programme(3);
    const { agent, csrf } = await admin();
    const community = await prisma.community.create({ data: { name: 'Assembly WA' } });
    const p = await person('Finished', community.id);
    const other = await person('Not yet', community.id);

    await agent.post(`/api/admin/library/trainees/${p.id}/credit`).set('X-CSRF-Token', csrf).send({ books: 2 });
    await agent.post(`/api/admin/library/trainees/${other.id}/credit`).set('X-CSRF-Token', csrf).send({ books: 2 });
    expect((await certificateEligibility(p.id)).eligible).toBe(false);
    expect((await readyToLeadIn(community.id)).items).toEqual([]);

    await agent.post(`/api/admin/library/trainees/${p.id}/credit`).set('X-CSRF-Token', csrf).send({ books: 3 });
    expect(await certificateEligibility(p.id)).toEqual({ eligible: true, passed: 3, total: 3 });
    expect((await readyToLeadIn(community.id)).items.map((i) => i.personId)).toEqual([p.id]);
    // The other person still has a book to do.
    expect((await certificateEligibility(other.id)).eligible).toBe(false);
  });

  it('can combine with exams passed in the app (credit covers the first books, the app the rest)', async () => {
    const exams = await programme(3);
    const { agent, csrf } = await admin();
    const community = await prisma.community.create({ data: { name: 'Assembly Mix' } });
    const p = await person('Mixed', community.id);
    await agent.post(`/api/admin/library/trainees/${p.id}/credit`).set('X-CSRF-Token', csrf).send({ books: 2 });
    await prisma.attempt.create({ data: { personId: p.id, assessmentId: exams[2], attemptNumber: 1, status: 'SUBMITTED', submittedAt: new Date(), passed: true, percentage: 88, score: 8, maxScore: 10 } });
    expect((await certificateEligibility(p.id)).eligible).toBe(true);
    expect((await readyToLeadIn(community.id)).items.map((i) => i.personId)).toEqual([p.id]);
  });

  it('tells the person in a private message, only when the number goes up', async () => {
    await programme(3);
    const { agent, csrf, adminUser } = await admin();
    const founder = await person('Founder');
    await prisma.user.update({ where: { id: adminUser.id }, data: { personId: founder.id } });
    const p = await person('Told');

    const first = await agent.post(`/api/admin/library/trainees/${p.id}/credit`).set('X-CSRF-Token', csrf).send({ books: 2 });
    expect(first.body.notified).toBe(true);
    const messages = await prisma.privateMessage.findMany({ where: { senderPersonId: founder.id } });
    expect(messages).toHaveLength(1);
    expect(messages[0].body).toContain('2 books');
    expect(messages[0].body).toContain('Book 3');

    const same = await agent.post(`/api/admin/library/trainees/${p.id}/credit`).set('X-CSRF-Token', csrf).send({ books: 2 });
    expect(same.body.notified).toBe(false);
    const quiet = await agent.post(`/api/admin/library/trainees/${p.id}/credit`).set('X-CSRF-Token', csrf).send({ books: 3, notify: false });
    expect(quiet.body.notified).toBe(false);
    expect(await prisma.privateMessage.count({ where: { senderPersonId: founder.id } })).toBe(1);
  });

  it('refuses more books than the programme has, and a missing person', async () => {
    await programme(3);
    const { agent, csrf } = await admin();
    const p = await person('Too many');
    const tooMany = await agent.post(`/api/admin/library/trainees/${p.id}/credit`).set('X-CSRF-Token', csrf).send({ books: 4 });
    expect(tooMany.status).toBe(400);
    const missing = await agent.post('/api/admin/library/trainees/nobody/credit').set('X-CSRF-Token', csrf).send({ books: 1 });
    expect(missing.status).toBe(404);
    expect(await prisma.trainingEnrollment.count({ where: { personId: p.id } })).toBe(0);
  });

  it('is only for the central admin', async () => {
    await programme(2);
    const p = await person('Anyone');
    const res = await request(app).post(`/api/admin/library/trainees/${p.id}/credit`).send({ books: 1 });
    expect([401, 403]).toContain(res.status);
  });
});

