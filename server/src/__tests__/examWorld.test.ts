import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { Readable } from 'stream';
import bcrypt from 'bcryptjs';

vi.mock('../lib/storage', () => ({
  isStorageConfigured: vi.fn(() => true),
  createUploadUrl: vi.fn(async ({ storageKey }: { storageKey: string }) => ({
    url: `https://mock-r2.example/upload/${storageKey}`,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  })),
  createDownloadUrl: vi.fn(async ({ storageKey }: { storageKey: string }) => ({
    url: `https://mock-r2.example/download/${storageKey}`,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  })),
  headObject: vi.fn(async () => null),
  getObjectStream: vi.fn(async () => ({ body: Readable.from([Buffer.from('%PDF-1.4 fake')]), contentLength: 13 })),
}));

import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import * as storage from '../lib/storage';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';

const app = createApp();

let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.117.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) {
    wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', ip);
  }
  return wrapped;
}
type Agent = ReturnType<typeof agentWithUniqueIp>;

let n = 0;
async function member(name: string) {
  n += 1;
  const whatsapp = `+2376705${String(n).padStart(5, '0')}`;
  const person = await prisma.person.create({ data: { name, whatsappNumber: whatsapp } });
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  const ra = agentWithUniqueIp();
  const { csrf: rc } = await bootstrap(ra as any);
  await ra.post('/api/member/auth/request-link').set('X-CSRF-Token', rc).send({ whatsapp, email: `exam${n}@example.com` });
  const link = spy.mock.calls[spy.mock.calls.length - 1][0].link as string;
  spy.mockRestore();
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/member/auth/consume').set('X-CSRF-Token', csrf).send({ token: new URL(link).searchParams.get('token') });
  return { agent, csrf, id: person.id, whatsapp };
}

async function admin() {
  n += 1;
  const email = `exam-admin-${n}@test.local`;
  await createAdmin(email, 'AdminPass123!');
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'AdminPass123!' });
  return { agent, csrf };
}

const post = (who: { agent: Agent; csrf: string }, path: string, body: Record<string, unknown> = {}) => who.agent.post(path).set('X-CSRF-Token', who.csrf).send(body);

/** One question, option A correct, option B wrong; publishes the exam. */
async function giveExamOneQuestion(assessmentId: string) {
  const q = await prisma.question.create({ data: { assessmentId, textEn: 'Q1', order: 0, points: 1 } });
  const right = await prisma.option.create({ data: { questionId: q.id, textEn: 'Right', isCorrect: true, order: 0 } });
  const wrong = await prisma.option.create({ data: { questionId: q.id, textEn: 'Wrong', isCorrect: false, order: 1 } });
  await prisma.assessment.update({ where: { id: assessmentId }, data: { status: 'PUBLISHED' } });
  return { questionId: q.id, right: right.id, wrong: wrong.id };
}

async function takeExam(m: { agent: Agent; csrf: string }, assessmentId: string, questionId: string, optionId: string) {
  const start = await post(m, `/api/member/assessments/${assessmentId}/attempts`);
  expect([200, 201]).toContain(start.status);
  const submit = await post(m, `/api/member/attempts/${start.body.id}/submit`, { answers: [{ questionId, selectedOptionId: optionId }] });
  return { start, submit };
}

async function trainingBook(a: { agent: Agent; csrf: string }, order: number) {
  const res = await post(a, '/api/admin/library/books', { kind: 'TRAINING', titleEn: `Leadership ${order}`, trainingOrder: order });
  expect(res.status).toBe(201);
  await prisma.libraryBook.update({ where: { id: res.body.id }, data: { storageKey: `library/${res.body.id}/x.pdf`, byteSize: 13 } });
  const exam = await prisma.assessment.findUnique({ where: { trainingBookId: res.body.id } });
  return { bookId: res.body.id as string, examId: exam!.id };
}

afterEach(() => vi.clearAllMocks());

describe('Leadership training: paid access and books in order', () => {
  it('creates each book with a draft exam at 70%', async () => {
    const a = await admin();
    const { examId } = await trainingBook(a, 1);
    const exam = await prisma.assessment.findUnique({ where: { id: examId } });
    expect(exam).toMatchObject({ passMark: 70, status: 'DRAFT', maxAttempts: null });
    expect((await post(a, '/api/admin/library/books', { kind: 'TRAINING', titleEn: 'Dup', trainingOrder: 1 })).body.code).toBe('DUPLICATE');
  });

  it('keeps every book closed until the admin marks the member as paid', async () => {
    const a = await admin();
    const b1 = await trainingBook(a, 1);
    const m = await member('Trainee');

    let world = await m.agent.get('/api/member/exam-world');
    expect(world.body.training.enrollment).toBe('NONE');
    expect(world.body.training.books[0].unlocked).toBe(false);
    expect((await m.agent.get(`/api/member/library/books/${b1.bookId}/content`)).status).toBe(404);

    expect((await post(m, '/api/member/training/request')).body.enrollment).toBe('REQUESTED');
    const requests = await a.agent.get('/api/admin/library/trainees?status=REQUESTED');
    expect(requests.body.items.map((r: any) => r.name)).toEqual(['Trainee']);

    await post(a, '/api/admin/library/trainees', { personId: m.id, note: 'Paid by MoMo' });
    world = await m.agent.get('/api/member/exam-world');
    expect(world.body.training.enrollment).toBe('ACTIVE');
    expect(world.body.training.books[0]).toMatchObject({ unlocked: true, canRead: true });
  });

  it('opens Book 2 only after Book 1 is passed with 70%, and keeps it open', async () => {
    const a = await admin();
    const b1 = await trainingBook(a, 1);
    const b2 = await trainingBook(a, 2);
    const q1 = await giveExamOneQuestion(b1.examId);
    const m = await member('Climber');
    await post(a, '/api/admin/library/trainees', { personId: m.id });

    expect((await m.agent.get(`/api/member/library/books/${b2.bookId}`)).status).toBe(404);
    expect((await post(m, `/api/member/assessments/${b2.examId}/attempts`)).status).toBe(404);

    const fail = await takeExam(m, b1.examId, q1.questionId, q1.wrong);
    expect(fail.submit.body.passed).toBe(false);
    let world = await m.agent.get('/api/member/exam-world');
    expect(world.body.training.books[1].unlocked).toBe(false);

    const pass = await takeExam(m, b1.examId, q1.questionId, q1.right);
    expect(pass.submit.body.passed).toBe(true);
    world = await m.agent.get('/api/member/exam-world');
    expect(world.body.training.books.map((b: any) => b.unlocked)).toEqual([true, true]);
    expect(world.body.training.books[0].exam).toMatchObject({ passed: true, bestPercentage: 100 });
    expect((await m.agent.get(`/api/member/library/books/${b2.bookId}`)).status).toBe(200);
  });
});

describe('Reading books inside the app', () => {
  it('streams the PDF inline, never cached, with the reader’s name and phone for the watermark', async () => {
    const a = await admin();
    const b1 = await trainingBook(a, 1);
    const m = await member('Reader Ruth');
    await post(a, '/api/admin/library/trainees', { personId: m.id });

    const meta = await m.agent.get(`/api/member/library/books/${b1.bookId}`);
    expect(meta.body.watermark).toBe(`Reader Ruth · ${m.whatsapp}`);

    const content = await m.agent.get(`/api/member/library/books/${b1.bookId}/content`).buffer(true);
    expect(content.status).toBe(200);
    expect(content.headers['content-type']).toBe('application/pdf');
    expect(content.headers['content-disposition']).toBe('inline');
    expect(content.headers['cache-control']).toContain('no-store');
  });

  it('lets any member read the monthly devotional book', async () => {
    const a = await admin();
    const devotional = await prisma.monthlyDevotional.create({
      data: { titleEn: 'October', contentEn: '-', startDate: new Date(), endDate: new Date(Date.now() + 20 * 86400000), status: 'PUBLISHED' },
    });
    const book = await post(a, '/api/admin/library/books', { kind: 'DEVOTIONAL', titleEn: 'October book', devotionalId: devotional.id });
    await prisma.libraryBook.update({ where: { id: book.body.id }, data: { storageKey: `library/${book.body.id}/x.pdf`, byteSize: 13 } });
    const m = await member('Any Member');
    const world = await m.agent.get('/api/member/exam-world');
    expect(world.body.devotionals[0].bookId).toBe(book.body.id);
    expect((await m.agent.get(`/api/member/library/books/${book.body.id}/content`)).status).toBe(200);
  });

  it('verifies an uploaded PDF before attaching it', async () => {
    const a = await admin();
    const created = await post(a, '/api/admin/library/books', { kind: 'TRAINING', titleEn: 'Upload me', trainingOrder: 9 });
    const auth = await post(a, `/api/admin/library/books/${created.body.id}/file/authorize`, { mimeType: 'application/pdf', byteSize: 1000 });
    expect(auth.body.storageKey).toMatch(new RegExp(`^library/${created.body.id}/[0-9a-f-]{36}\\.pdf$`));
    expect((await post(a, `/api/admin/library/books/${created.body.id}/file`, { storageKey: auth.body.storageKey, byteSize: 1000 })).status).toBe(400);
    vi.mocked(storage.headObject).mockResolvedValueOnce({ contentLength: 1000, contentType: 'application/pdf' });
    expect((await post(a, `/api/admin/library/books/${created.body.id}/file`, { storageKey: auth.body.storageKey, byteSize: 1000 })).status).toBe(200);
    expect((await post(a, `/api/admin/library/books/${created.body.id}/file/authorize`, { mimeType: 'image/png', byteSize: 10 })).body.code).toBe('NOT_PDF');
  });
});

describe('Monthly devotional weekly exams', () => {
  async function devotionalWithWeek1(a: { agent: Agent; csrf: string }, endsInDays = 20) {
    const devotional = await prisma.monthlyDevotional.create({
      data: {
        titleEn: 'Faith month',
        contentEn: '-',
        startDate: new Date(Date.now() - 5 * 86400000),
        endDate: new Date(Date.now() + endsInDays * 86400000),
        status: 'PUBLISHED',
      },
    });
    const week = await post(a, `/api/admin/library/devotionals/${devotional.id}/weekly-exams`, { weekNumber: 1 });
    expect(week.status).toBe(201);
    const q = await giveExamOneQuestion(week.body.id);
    return { devotional, examId: week.body.id as string, q };
  }

  it('shows Week 1 in Exam World; only the first try is the score', async () => {
    const a = await admin();
    const { examId, q } = await devotionalWithWeek1(a);
    const m = await member('Weekly Taker');

    await takeExam(m, examId, q.questionId, q.wrong);
    await takeExam(m, examId, q.questionId, q.right);

    const world = await m.agent.get('/api/member/exam-world');
    expect(world.body.devotionals[0].exams[0]).toMatchObject({ weekNumber: 1, open: true, firstScore: 0, firstPassed: false, tries: 2 });

    const info = await m.agent.get(`/api/member/assessments/${examId}`);
    expect(info.body).toMatchObject({ weekNumber: 1, firstTryCounts: true, open: true });
  });

  it('shows the right answers after submitting', async () => {
    const a = await admin();
    const { examId, q } = await devotionalWithWeek1(a);
    const m = await member('Answer Seeker');
    const { start } = await takeExam(m, examId, q.questionId, q.wrong);
    const review = await m.agent.get(`/api/member/attempts/${start.body.id}/questions`);
    const options = review.body.questions[0].options;
    expect(options.find((o: any) => o.id === q.right).isCorrect).toBe(true);
    expect(review.body.questions[0].selectedOptionId).toBe(q.wrong);
  });

  it('closes the weekly exam after the devotional ends', async () => {
    const a = await admin();
    const { examId } = await devotionalWithWeek1(a, -3);
    const m = await member('Too Late');
    const res = await post(m, `/api/member/assessments/${examId}/attempts`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EXAM_CLOSED');
  });

  it('refuses a second exam for the same week', async () => {
    const a = await admin();
    const { devotional } = await devotionalWithWeek1(a);
    expect((await post(a, `/api/admin/library/devotionals/${devotional.id}/weekly-exams`, { weekNumber: 1 })).body.code).toBe('DUPLICATE');
  });
});

describe('Free-will offering', () => {
  it('shows the instructions and records "I have given" with an optional amount', async () => {
    const a = await admin();
    await a.agent.put('/api/admin/library/offering-settings').set('X-CSRF-Token', a.csrf).send({ instructionsEn: 'MoMo 6XX', instructionsFr: 'MoMo 6XX (fr)' });
    const devotional = await prisma.monthlyDevotional.create({
      data: { titleEn: 'Giving month', contentEn: '-', startDate: new Date(), endDate: new Date(Date.now() + 86400000 * 20), status: 'PUBLISHED' },
    });
    const m = await member('Giver');

    let world = await m.agent.get('/api/member/exam-world');
    expect(world.body.offering.instructionsEn).toBe('MoMo 6XX');
    expect(world.body.devotionals[0].iGaveOffering).toBe(false);

    expect((await post(m, `/api/member/devotionals/${devotional.id}/offering`, { amount: 2000 })).status).toBe(201);
    expect((await post(m, `/api/member/devotionals/${devotional.id}/offering`, {})).status).toBe(201);
    world = await m.agent.get('/api/member/exam-world');
    expect(world.body.devotionals[0].iGaveOffering).toBe(true);

    const list = await a.agent.get(`/api/admin/library/devotionals/${devotional.id}/offerings`);
    expect(list.body).toMatchObject({ total: 2000, count: 2 });
  });
});

describe('Leader exam results', () => {
  it('shows a leader the first-try weekly scores and books passed for their group', async () => {
    const a = await admin();
    const devotional = await prisma.monthlyDevotional.create({
      data: { titleEn: 'Results month', contentEn: '-', startDate: new Date(), endDate: new Date(Date.now() + 86400000 * 20), status: 'PUBLISHED' },
    });
    const week = await post(a, `/api/admin/library/devotionals/${devotional.id}/weekly-exams`, { weekNumber: 1 });
    const q = await giveExamOneQuestion(week.body.id);

    const m = await member('Group Member');
    const leaderMember = await member('Group Leader');
    const group = await prisma.community.create({ data: { name: 'Results group' } });
    await prisma.communityMembership.create({ data: { personId: m.id, communityId: group.id } });
    const adminUser = (await prisma.user.findFirst({ where: { role: 'ADMIN' } }))!;
    await prisma.roleAssignment.create({ data: { personId: leaderMember.id, roleType: 'SCOPED_LEADER', communityId: group.id, assignedByUserId: adminUser.id } });
    await takeExam(m, week.body.id, q.questionId, q.right);

    n += 1;
    const email = `results-leader-${n}@test.local`;
    await prisma.user.create({ data: { name: 'L', email, passwordHash: await bcrypt.hash('LeaderPass123!', 10), role: 'LEADER', active: true, personId: leaderMember.id } });
    const leader = agentWithUniqueIp();
    const { csrf } = await bootstrap(leader as any);
    await leader.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'LeaderPass123!' });

    const res = await leader.get('/api/leader/exam-results');
    expect(res.body.weeks).toEqual([1]);
    expect(res.body.items).toEqual([{ personId: m.id, name: 'Group Member', weekly: [100], training: 'NONE', booksPassed: 0 }]);
  });
});
