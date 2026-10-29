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

/** A leadership book exam with one question in each of `sets` sets (option "Right" correct). */
async function giveBookExamSets(assessmentId: string, sets: number[]) {
  for (const setNumber of sets) {
    const q = await prisma.question.create({ data: { assessmentId, textEn: `Set ${setNumber} question`, order: 0, points: 1, setNumber } });
    await prisma.option.create({ data: { questionId: q.id, textEn: 'Right', isCorrect: true, order: 0 } });
    await prisma.option.create({ data: { questionId: q.id, textEn: 'Wrong', isCorrect: false, order: 1 } });
  }
  await prisma.assessment.update({ where: { id: assessmentId }, data: { status: 'PUBLISHED' } });
}

/** Starts (or resumes) a try, answers every question it shows with "Right" or "Wrong", and submits. */
async function takeBookExam(m: { agent: Agent; csrf: string }, assessmentId: string, answer: 'Right' | 'Wrong') {
  const start = await post(m, `/api/member/assessments/${assessmentId}/attempts`);
  if (![200, 201].includes(start.status)) return { start, submit: null, shown: [] as string[] };
  const qs = await m.agent.get(`/api/member/attempts/${start.body.id}/questions`);
  const answers = qs.body.questions.map((q: any) => ({ questionId: q.id, selectedOptionId: q.options.find((o: any) => o.textEn === answer).id }));
  const submit = await post(m, `/api/member/attempts/${start.body.id}/submit`, { answers });
  return { start, submit, shown: qs.body.questions.map((q: any) => q.textEn) as string[] };
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

  it('"Begin my training" opens Book 1 at once, on trust; a training the admin stopped stays stopped', async () => {
    const a = await admin();
    const b1 = await trainingBook(a, 1);
    const m = await member('Trainee');

    let world = await m.agent.get('/api/member/exam-world');
    expect(world.body.training.enrollment).toBe('NONE');
    expect(world.body.training.books[0]).toMatchObject({ unlocked: false, lockedBecause: 'NOT_STARTED' });
    expect((await m.agent.get(`/api/member/library/books/${b1.bookId}/content`)).status).toBe(404);

    expect((await post(m, '/api/member/training/request')).body.enrollment).toBe('ACTIVE');
    world = await m.agent.get('/api/member/exam-world');
    expect(world.body.training).toMatchObject({ enrollment: 'ACTIVE', price: 1200, owed: { books: 1, amount: 1200 }, automaticPayments: false });
    expect(world.body.training.books[0]).toMatchObject({ unlocked: true, canRead: true, payment: null });

    await post(a, `/api/admin/library/trainees/${m.id}/revoke`);
    expect((await post(m, '/api/member/training/request')).body.enrollment).toBe('REVOKED');
    expect((await m.agent.get(`/api/member/library/books/${b1.bookId}/content`)).status).toBe(404);
  });

  it('opens Book 2 only after Book 1 is passed with 70%, and keeps it open', async () => {
    const a = await admin();
    const b1 = await trainingBook(a, 1);
    const b2 = await trainingBook(a, 2);
    await giveBookExamSets(b1.examId, [1, 2]);
    const m = await member('Climber');
    await post(a, '/api/admin/library/trainees', { personId: m.id });

    expect((await m.agent.get(`/api/member/library/books/${b2.bookId}`)).status).toBe(404);
    expect((await post(m, `/api/member/assessments/${b2.examId}/attempts`)).status).toBe(404);

    const fail = await takeBookExam(m, b1.examId, 'Wrong');
    expect(fail.submit!.body.passed).toBe(false);
    let world = await m.agent.get('/api/member/exam-world');
    expect(world.body.training.books[1].unlocked).toBe(false);

    const request = await post(m, `/api/member/assessments/${b1.examId}/retake-request`);
    const retakes = await a.agent.get('/api/admin/library/retakes');
    await post(a, `/api/admin/library/retakes/${retakes.body.items.find((r: any) => r.person.id === m.id).id}`, { decision: 'GRANT' });
    expect(request.status).toBe(201);

    const pass = await takeBookExam(m, b1.examId, 'Right');
    expect(pass.submit!.body.passed).toBe(true);
    // Passed, but Book 1 still has to be paid before Book 2 opens.
    world = await m.agent.get('/api/member/exam-world');
    expect(world.body.training.books[1]).toMatchObject({ unlocked: false, lockedBecause: 'PAYMENT' });
    await post(a, '/api/admin/library/payments', { personId: m.id, bookId: b1.bookId, reference: 'CASH' });
    world = await m.agent.get('/api/member/exam-world');
    expect(world.body.training.books.map((b: any) => b.unlocked)).toEqual([true, true]);
    expect(world.body.training.books[0].exam).toMatchObject({ passed: true, bestPercentage: 100 });
    expect((await m.agent.get(`/api/member/library/books/${b2.bookId}`)).status).toBe(200);
  });
});

describe('Paying for leadership books', () => {
  async function setup(bookCount: number) {
    const a = await admin();
    const books = [];
    for (let i = 1; i <= bookCount; i++) {
      const b = await trainingBook(a, i);
      await giveBookExamSets(b.examId, [1]);
      books.push(b);
    }
    const m = await member('Payer');
    await post(m, '/api/member/training/request');
    return { a, m, books };
  }
  const world = async (m: { agent: Agent }) => (await m.agent.get('/api/member/exam-world')).body.training;

  it('"I have paid" with the transaction ID waits for the admin; confirming opens the next book', async () => {
    const { a, m, books } = await setup(2);
    await takeBookExam(m, books[0].examId, 'Right');
    expect((await world(m)).books[1].lockedBecause).toBe('PAYMENT');

    expect((await post(m, `/api/member/training/books/${books[0].bookId}/payments`, { reference: 'x' })).body.code).toBe('INVALID');
    const claim = await post(m, `/api/member/training/books/${books[0].bookId}/payments`, { reference: 'MP241021.1234.A56789', payerPhone: '+237 670 000 001' });
    expect(claim.status).toBe(201);
    expect((await post(m, `/api/member/training/books/${books[0].bookId}/payments`, { reference: 'again123' })).body.code).toBe('WAITING');
    expect((await post(m, `/api/member/training/books/${books[1].bookId}/payments`, { reference: 'notyet123' })).status).toBe(404);
    expect((await world(m)).books[0].payment).toBe('CLAIMED');

    const list = await a.agent.get('/api/admin/library/payments');
    expect(list.body.items).toEqual([expect.objectContaining({ bookNumber: 1, amount: 1200, reference: 'MP241021.1234.A56789', status: 'CLAIMED' })]);
    expect((await post(a, `/api/admin/library/payments/${claim.body.id}`, { decision: 'CONFIRM' })).body.status).toBe('CONFIRMED');
    expect((await post(a, `/api/admin/library/payments/${claim.body.id}`, { decision: 'REJECT' })).status).toBe(409);
    expect(await prisma.notification.findFirst({ where: { recipientPersonId: m.id, type: 'BOOK_PAYMENT_CONFIRMED' } })).not.toBeNull();

    const w = await world(m);
    expect(w.books.map((b: any) => [b.unlocked, b.payment])).toEqual([[true, 'PAID'], [true, null]]);
    expect(w.owed).toEqual({ books: 1, amount: 1200 });
    const summary = await a.agent.get('/api/admin/library/payments/summary');
    expect(summary.body).toMatchObject({ confirmed: { count: 1, amount: 1200 }, thisMonth: { count: 1, amount: 1200 }, waiting: 0 });
  });

  it('passing a book with the next one waiting for payment tells the member (once), and mentions paying for several', async () => {
    const { m, books } = await setup(2);
    const first = await takeBookExam(m, books[0].examId, 'Right');
    expect(first.submit!.body.passed).toBe(true);
    expect(first.submit!.body.payPrompt).toEqual({ bookNumber: 1, payableCount: 2, nextWaitsForPayment: true });
    const note = await prisma.notification.findMany({ where: { recipientPersonId: m.id, type: 'BOOK_PASSED_PAY' } });
    expect(note).toHaveLength(1);
    expect((note[0].metadata as any).bookNumber).toBe(1);
  });

  it('no prompt when the exam is failed', async () => {
    const { m, books } = await setup(2);
    const failed = await takeBookExam(m, books[0].examId, 'Wrong');
    expect(failed.submit!.body.passed).toBe(false);
    expect(failed.submit!.body.payPrompt).toBeUndefined();
    expect(await prisma.notification.count({ where: { recipientPersonId: m.id, type: 'BOOK_PASSED_PAY' } })).toBe(0);
  });

  it('no prompt when nothing is left to pay', async () => {
    const { a, m, books } = await setup(2);
    // Everything is paid first: passing then says nothing about paying.
    for (const b of books) await post(a, '/api/admin/library/payments', { personId: m.id, bookId: b.bookId });
    const passed = await takeBookExam(m, books[0].examId, 'Right');
    expect(passed.submit!.body.passed).toBe(true);
    expect(passed.submit!.body.payPrompt).toBeUndefined();
    expect(await prisma.notification.count({ where: { recipientPersonId: m.id, type: 'BOOK_PASSED_PAY' } })).toBe(0);
  });

  it('a rejected payment can be sent again', async () => {
    const { a, m, books } = await setup(1);
    const claim = await post(m, `/api/member/training/books/${books[0].bookId}/payments`, { reference: 'WRONG-ID-1' });
    await post(a, `/api/admin/library/payments/${claim.body.id}`, { decision: 'REJECT', note: 'Not found on our phone' });
    expect(await prisma.notification.findFirst({ where: { recipientPersonId: m.id, type: 'BOOK_PAYMENT_REJECTED' } })).not.toBeNull();
    expect((await world(m)).books[0].payment).toBeNull();
    expect((await post(m, `/api/member/training/books/${books[0].bookId}/payments`, { reference: 'RIGHT-ID-2' })).status).toBe(201);
  });

  it('grace: up to the granted number of books owed at once, never more; books stay open when grace ends', async () => {
    const { a, m, books } = await setup(4);
    expect((await post(m, '/api/member/training/grace', { books: 6 })).status).toBe(400);
    expect((await post(m, '/api/member/training/grace', { books: 2 })).status).toBe(201);
    const pending = await a.agent.get('/api/admin/library/grace');
    expect(pending.body.items).toEqual([expect.objectContaining({ books: 2, currentGraceBooks: 0 })]);
    await post(a, `/api/admin/library/grace/${pending.body.items[0].id}`, { decision: 'GRANT' });
    expect(await prisma.notification.findFirst({ where: { recipientPersonId: m.id, type: 'TRAINING_GRACE_GRANTED' } })).not.toBeNull();

    await takeBookExam(m, books[0].examId, 'Right');
    let w = await world(m);
    expect(w.books.map((b: any) => b.unlocked)).toEqual([true, true, false, false]);
    expect(w.owed).toEqual({ books: 2, amount: 2400 });

    await takeBookExam(m, books[1].examId, 'Right');
    w = await world(m);
    expect(w.books[2]).toMatchObject({ unlocked: false, lockedBecause: 'PAYMENT' });

    // Paying one owed book lets the next one open.
    await post(a, '/api/admin/library/payments', { personId: m.id, bookId: books[0].bookId });
    w = await world(m);
    expect(w.books.map((b: any) => b.unlocked)).toEqual([true, true, true, false]);

    // Ending the grace keeps what's open, but nothing more opens unpaid.
    await post(a, `/api/admin/library/trainees/${m.id}/grace`, { books: 0 });
    await takeBookExam(m, books[2].examId, 'Right');
    w = await world(m);
    expect(w.books.map((b: any) => b.unlocked)).toEqual([true, true, true, false]);
    expect(w.owed.books).toBe(2);
  });

  it('refuses a transaction ID that was already used for another payment, but not one that was rejected', async () => {
    const { a, m, books } = await setup(2);
    const other = await member('Second Trainee');
    await post(a, '/api/admin/library/trainees', { personId: other.id });

    const first = await post(m, `/api/member/training/books/${books[0].bookId}/payments`, { reference: 'MP241021.9999.Z11111' });
    expect(first.status).toBe(201);
    // Someone else typing the same ID (even in other letters) is refused.
    const copy = await post(other, `/api/member/training/books/${books[0].bookId}/payments`, { reference: 'mp241021.9999.z11111' });
    expect(copy.status).toBe(409);
    expect(copy.body.code).toBe('DUPLICATE_REFERENCE');

    // If the admin rejects the first claim (a mistake), that ID can be tried again.
    await post(a, `/api/admin/library/payments/${first.body.id}`, { decision: 'REJECT' });
    expect((await post(other, `/api/member/training/books/${books[0].bookId}/payments`, { reference: 'MP241021.9999.Z11111' })).status).toBe(201);
  });

  it('a payment the admin records (cash) settles a waiting claim', async () => {
    const { a, m, books } = await setup(1);
    await post(m, `/api/member/training/books/${books[0].bookId}/payments`, { reference: 'CLAIM-123' });
    expect((await post(a, '/api/admin/library/payments', { personId: m.id, bookId: books[0].bookId, note: 'Paid cash at church' })).status).toBe(201);
    expect((await post(a, '/api/admin/library/payments', { personId: m.id, bookId: books[0].bookId })).body.code).toBe('ALREADY_PAID');
    expect((await a.agent.get('/api/admin/library/payments')).body.items).toEqual([]);
    expect((await world(m)).books[0].payment).toBe('PAID');
  });

  it('keeps the amount and date of payments when the person is deleted, without the name', async () => {
    const { a, m, books } = await setup(1);
    await post(a, '/api/admin/library/payments', { personId: m.id, bookId: books[0].bookId });
    await prisma.person.delete({ where: { id: m.id } });
    const kept = await prisma.bookPayment.findMany();
    expect(kept).toEqual([expect.objectContaining({ personId: null, amount: 1200, bookNumber: 1, status: 'CONFIRMED' })]);
  });

  it('automatic Mobile Money: off until a payment company is connected; then its notification confirms the payment once', async () => {
    const { m, books } = await setup(2);
    expect((await post(m, `/api/member/training/books/${books[0].bookId}/pay-now`, { phone: '+237670000001' })).body.code).toBe('AUTOMATIC_OFF');

    const { registerPaymentProvider } = await import('../lib/payments');
    const requested: any[] = [];
    registerPaymentProvider({
      name: 'testpay',
      requestPayment: async (r) => {
        requested.push(r);
        return { providerRef: `tp-${requested.length}` };
      },
      readNotification: async (req) => (req.body?.secret === 'ok' ? { providerRef: req.body.ref, status: req.body.status } : null),
    });
    process.env.PAYMENT_PROVIDER = 'testpay';
    try {
      expect((await world(m)).automaticPayments).toBe(true);
      const started = await post(m, `/api/member/training/books/${books[0].bookId}/pay-now`, { phone: '+237 670 000 001' });
      expect(started.body.status).toBe('PENDING');
      expect(requested[0]).toMatchObject({ amount: 1200, currency: 'XAF', phone: '+237670000001' });
      expect((await world(m)).books[0].payment).toBe('PENDING');

      const hook = request(app);
      expect((await hook.post('/api/payments/webhook').send({ secret: 'bad', ref: 'tp-1', status: 'CONFIRMED' })).status).toBe(400);
      expect((await hook.post('/api/payments/webhook').send({ secret: 'ok', ref: 'tp-1', status: 'CONFIRMED' })).status).toBe(200);
      expect((await hook.post('/api/payments/webhook').send({ secret: 'ok', ref: 'tp-1', status: 'FAILED' })).status).toBe(200);
      expect((await world(m)).books[0].payment).toBe('PAID');
      expect(await prisma.notification.count({ where: { recipientPersonId: m.id, type: 'BOOK_PAYMENT_CONFIRMED' } })).toBe(1);
    } finally {
      delete process.env.PAYMENT_PROVIDER;
    }
  });
});

describe('Leadership book exams: one try, retakes with new questions', () => {
  async function setup(sets: number[]) {
    const a = await admin();
    const b1 = await trainingBook(a, 1);
    await giveBookExamSets(b1.examId, sets);
    const m = await member('Student');
    await post(a, '/api/admin/library/trainees', { personId: m.id });
    return { a, m, examId: b1.examId };
  }
  const retakeId = async (a: { agent: Agent }, personId: string) =>
    (await a.agent.get('/api/admin/library/retakes')).body.items.find((r: any) => r.person.id === personId)?.id as string;

  it('gives one whole set on the first try, the same one when the try is reopened', async () => {
    const { m, examId } = await setup([1, 2, 3]);
    const first = await post(m, `/api/member/assessments/${examId}/attempts`);
    expect(first.status).toBe(201);
    expect([1, 2, 3]).toContain(first.body.setNumber);
    const qs = await m.agent.get(`/api/member/attempts/${first.body.id}/questions`);
    expect(qs.body.questions.map((q: any) => q.textEn)).toEqual([`Set ${first.body.setNumber} question`]);
    expect(qs.body.questions[0].options[0]).not.toHaveProperty('isCorrect');

    const again = await post(m, `/api/member/assessments/${examId}/attempts`);
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(first.body.id);
  });

  it('after a failed try: no answers shown, no second try until the admin grants a retake, then a new set', async () => {
    const { a, m, examId } = await setup([1, 2]);
    const first = await takeBookExam(m, examId, 'Wrong');
    expect(first.submit!.body).toMatchObject({ passed: false, percentage: 0 });

    const review = await m.agent.get(`/api/member/attempts/${first.start.body.id}/questions`);
    expect(review.body).toMatchObject({ answersHidden: true, questions: [] });

    let detail = await m.agent.get(`/api/member/assessments/${examId}`);
    expect(detail.body.training).toMatchObject({ canStart: false, block: 'NEEDS_RETAKE', submittedTries: 1 });
    expect((await post(m, `/api/member/assessments/${examId}/attempts`)).body.code).toBe('NEEDS_RETAKE');

    expect((await post(m, `/api/member/assessments/${examId}/retake-request`)).status).toBe(201);
    detail = await m.agent.get(`/api/member/assessments/${examId}`);
    expect(detail.body.training.block).toBe('RETAKE_REQUESTED');

    const list = await a.agent.get('/api/admin/library/retakes');
    const item = list.body.items.find((r: any) => r.person.id === m.id);
    expect(item).toMatchObject({ bookNumber: 1, tries: 1, lastPercentage: 0, unusedSets: 1 });
    expect((await post(a, `/api/admin/library/retakes/${item.id}`, { decision: 'GRANT' })).body.status).toBe('GRANTED');
    expect(await prisma.notification.findFirst({ where: { recipientPersonId: m.id, type: 'EXAM_RETAKE_GRANTED' } })).not.toBeNull();

    const second = await takeBookExam(m, examId, 'Right');
    expect(second.start.body.setNumber).not.toBe(first.start.body.setNumber);
    expect(second.submit!.body.passed).toBe(true);
    detail = await m.agent.get(`/api/member/assessments/${examId}`);
    expect(detail.body.training).toMatchObject({ passed: true, block: 'PASSED', canStart: false });
    expect((await post(m, `/api/member/assessments/${examId}/retake-request`)).status).toBe(409);
  });

  it('a granted retake is used by one try only; a declined one can be asked for again', async () => {
    const { a, m, examId } = await setup([1, 2, 3]);
    await takeBookExam(m, examId, 'Wrong');
    await post(m, `/api/member/assessments/${examId}/retake-request`);
    await post(a, `/api/admin/library/retakes/${await retakeId(a, m.id)}`, { decision: 'GRANT' });
    await takeBookExam(m, examId, 'Wrong');
    expect((await post(m, `/api/member/assessments/${examId}/attempts`)).body.code).toBe('NEEDS_RETAKE');

    await post(m, `/api/member/assessments/${examId}/retake-request`);
    await post(a, `/api/admin/library/retakes/${await retakeId(a, m.id)}`, { decision: 'DECLINE' });
    expect((await m.agent.get(`/api/member/assessments/${examId}`)).body.training.block).toBe('RETAKE_DECLINED');
    expect((await post(m, `/api/member/assessments/${examId}/retake-request`)).status).toBe(201);
  });

  it('waits for new questions when every set has been used, and the admin can add a new set', async () => {
    const { a, m, examId } = await setup([1]);
    await takeBookExam(m, examId, 'Wrong');
    await post(m, `/api/member/assessments/${examId}/retake-request`);
    const id = await retakeId(a, m.id);
    expect((await a.agent.get('/api/admin/library/retakes')).body.items.find((r: any) => r.id === id).unusedSets).toBe(0);
    await post(a, `/api/admin/library/retakes/${id}`, { decision: 'GRANT' });
    expect((await m.agent.get(`/api/member/assessments/${examId}`)).body.training.block).toBe('NO_NEW_QUESTIONS');

    // Set 1 has been given, so it can't change; a new set can be written.
    const used = await prisma.question.findFirst({ where: { assessmentId: examId, setNumber: 1 } });
    expect((await a.agent.patch(`/api/admin/assessments/questions/${used!.id}`).set('X-CSRF-Token', a.csrf).send({ textEn: 'Changed' })).status).toBe(409);
    const added = await post(a, `/api/admin/assessments/${examId}/questions`, { textEn: 'Set 2 question', setNumber: 2 });
    expect(added.status).toBe(201);
    await post(a, `/api/admin/assessments/questions/${added.body.id}/options`, { textEn: 'Right', isCorrect: true });
    await post(a, `/api/admin/assessments/questions/${added.body.id}/options`, { textEn: 'Wrong' });

    const retake = await takeBookExam(m, examId, 'Right');
    expect(retake.start.body.setNumber).toBe(2);
    expect(retake.shown).toEqual(['Set 2 question']);
    expect(retake.submit!.body).toMatchObject({ passed: true, maxScore: 1 });
  });

  it('counts only the questions of the try’s own set', async () => {
    const { m, examId } = await setup([1, 2]);
    const r = await takeBookExam(m, examId, 'Right');
    expect(r.submit!.body).toMatchObject({ score: 1, maxScore: 1, percentage: 100 });
  });

  it('shows on the Learn page whether the exam can be taken and what it is waiting for', async () => {
    const { m, examId } = await setup([1, 2]);
    let world = await m.agent.get('/api/member/exam-world');
    expect(world.body.training.books[0].exam).toMatchObject({ id: examId, canStart: true, tries: 0, block: null });
    await takeBookExam(m, examId, 'Wrong');
    world = await m.agent.get('/api/member/exam-world');
    expect(world.body.training.books[0].exam).toMatchObject({ canStart: false, tries: 1, block: 'NEEDS_RETAKE' });
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

  it('has an English and a French copy: each reader gets their own language, or the other when only one exists', async () => {
    const a = await admin();
    const b1 = await trainingBook(a, 1); // English copy only, to start with
    const m = await member('Bilingual Reader');
    await post(a, '/api/admin/library/trainees', { personId: m.id });
    const streamed = () => vi.mocked(storage.getObjectStream).mock.calls.map((c) => c[0].storageKey);

    // Only English exists: a French reader still gets the book, in English.
    expect((await m.agent.get(`/api/member/library/books/${b1.bookId}?lang=fr`)).body).toMatchObject({ language: 'en', languages: ['en'] });
    expect((await m.agent.get(`/api/member/library/books/${b1.bookId}/content?lang=fr`).buffer(true)).status).toBe(200);
    expect(streamed().at(-1)).toBe(`library/${b1.bookId}/x.pdf`);

    // The admin uploads the French copy (a separate upload for the same book).
    const auth = await post(a, `/api/admin/library/books/${b1.bookId}/file/authorize`, { mimeType: 'application/pdf', byteSize: 2000 });
    vi.mocked(storage.headObject).mockResolvedValueOnce({ contentLength: 2000, contentType: 'application/pdf' });
    expect((await post(a, `/api/admin/library/books/${b1.bookId}/file`, { storageKey: auth.body.storageKey, byteSize: 2000, pageCount: 88, language: 'fr' })).status).toBe(200);
    const row = await prisma.libraryBook.findUniqueOrThrow({ where: { id: b1.bookId } });
    expect(row).toMatchObject({ storageKey: `library/${b1.bookId}/x.pdf`, storageKeyFr: auth.body.storageKey, byteSizeFr: 2000, pageCountFr: 88 });
    const listed = (await a.agent.get('/api/admin/library/books')).body.items.find((b: any) => b.id === b1.bookId);
    expect(listed).toMatchObject({ hasFile: true, hasFileFr: true, byteSizeFr: 2000, pageCountFr: 88 });

    const fr = await m.agent.get(`/api/member/library/books/${b1.bookId}?lang=fr`);
    expect(fr.body).toMatchObject({ language: 'fr', languages: ['en', 'fr'], byteSize: 2000, pageCount: 88 });
    const en = await m.agent.get(`/api/member/library/books/${b1.bookId}?lang=en`);
    expect(en.body).toMatchObject({ language: 'en', byteSize: 13 });
    // A different copy has a different version, so a phone keeps them apart.
    expect(fr.body.fileVersion).not.toBe(en.body.fileVersion);
    await m.agent.get(`/api/member/library/books/${b1.bookId}/content?lang=fr`).buffer(true);
    expect(streamed().at(-1)).toBe(auth.body.storageKey);
    // No language asked for: English.
    expect((await m.agent.get(`/api/member/library/books/${b1.bookId}`)).body.language).toBe('en');
  });

  it('opens a book that exists only in French', async () => {
    const a = await admin();
    const created = await post(a, '/api/admin/library/books', { kind: 'TRAINING', titleEn: 'French only', trainingOrder: 7 });
    await prisma.libraryBook.update({ where: { id: created.body.id }, data: { storageKeyFr: `library/${created.body.id}/fr.pdf`, byteSizeFr: 20, pageCountFr: 5 } });
    const m = await member('French Only Reader');
    await post(a, '/api/admin/library/trainees', { personId: m.id });
    const dev = await prisma.libraryBook.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(dev.storageKey).toBeNull();
    // Book 7 is not open yet for a new trainee, but the file exists: the admin list says so.
    const listed = (await a.agent.get('/api/admin/library/books')).body.items.find((b: any) => b.id === created.body.id);
    expect(listed).toMatchObject({ hasFile: false, hasFileFr: true });
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

describe('Leadership School: covers, pages and chapter summaries', () => {
  // A real 1×1 JPEG and PNG header are enough for the picture checks.
  const JPEG = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString('base64')}`;
  const PNG = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]).toString('base64')}`;

  it('shows every book with its cover, even before it opens; an automatic cover never replaces the admin\'s own', async () => {
    const a = await admin();
    const b1 = await trainingBook(a, 1);
    const b2 = await trainingBook(a, 2);
    const m = await member('School Visitor');

    let school = await m.agent.get('/api/member/school');
    expect(school.status).toBe(200);
    expect(school.body.books.map((b: any) => b.coverUrl)).toEqual([null, null]);

    const auto = await a.agent.put(`/api/admin/library/books/${b2.bookId}/cover`).set('X-CSRF-Token', a.csrf).send({ image: JPEG, source: 'AUTO' });
    expect(auto.status).toBe(200);
    school = await m.agent.get('/api/member/school');
    const url = school.body.books[1].coverUrl as string;
    expect(url).toMatch(new RegExp(`^/api/member/library/books/${b2.bookId}/cover\\?v=[0-9a-f]+$`));
    // Book 2 is still closed for this member, but its cover shows.
    expect(school.body.books[1].unlocked).toBe(false);
    const pic = await m.agent.get(url);
    expect(pic.status).toBe(200);
    expect(pic.headers['content-type']).toBe('image/jpeg');
    expect(pic.headers['cache-control']).toContain('immutable');

    await a.agent.put(`/api/admin/library/books/${b2.bookId}/cover`).set('X-CSRF-Token', a.csrf).send({ image: PNG, source: 'MANUAL' });
    const kept = await a.agent.put(`/api/admin/library/books/${b2.bookId}/cover`).set('X-CSRF-Token', a.csrf).send({ image: JPEG, source: 'AUTO' });
    expect(kept.body.kept).toBe(true);
    school = await m.agent.get('/api/member/school');
    expect(school.body.books[1].coverUrl).not.toBe(url);
    expect((await m.agent.get(school.body.books[1].coverUrl)).headers['content-type']).toBe('image/png');

    // Not a picture, or a picture pretending to be another kind: refused.
    const fake = `data:image/png;base64,${Buffer.from('<svg onload=alert(1)>').toString('base64')}`;
    expect((await a.agent.put(`/api/admin/library/books/${b1.bookId}/cover`).set('X-CSRF-Token', a.csrf).send({ image: fake, source: 'MANUAL' })).body.code).toBe('INVALID_COVER');
    expect((await a.agent.put(`/api/admin/library/books/${b1.bookId}/cover`).set('X-CSRF-Token', a.csrf).send({ image: JPEG.replace('jpeg', 'png'), source: 'MANUAL' })).body.code).toBe('INVALID_COVER');

    expect((await a.agent.delete(`/api/admin/library/books/${b2.bookId}/cover`).set('X-CSRF-Token', a.csrf)).status).toBe(200);
    expect((await m.agent.get('/api/member/school')).body.books[1].coverUrl).toBeNull();
    // Members only.
    expect((await request(app).get(url)).status).toBe(401);
  });

  it('a book can have its own French cover next to the English one', async () => {
    const a = await admin();
    const b1 = await trainingBook(a, 1);
    const m = await member('French Cover Reader');
    const put = (image: string, source: string, language?: string) =>
      a.agent.put(`/api/admin/library/books/${b1.bookId}/cover`).set('X-CSRF-Token', a.csrf).send({ image, source, language });

    await put(JPEG, 'AUTO');
    let book = (await m.agent.get('/api/member/school')).body.books[0];
    expect(book.coverUrlFr).toBeNull();

    const fr = await put(PNG, 'AUTO', 'fr');
    expect(fr.body.coverUrlFr).toContain('lang=fr');
    book = (await m.agent.get('/api/member/school')).body.books[0];
    expect(book.coverUrlFr).toMatch(new RegExp(`^/api/member/library/books/${b1.bookId}/cover\\?lang=fr&v=[0-9a-f]+$`));
    expect((await m.agent.get(book.coverUrl)).headers['content-type']).toBe('image/jpeg');
    expect((await m.agent.get(book.coverUrlFr)).headers['content-type']).toBe('image/png');

    // The admin's own French picture is not replaced by an automatic one, and the English cover is untouched.
    await put(JPEG, 'MANUAL', 'fr');
    expect((await put(PNG, 'AUTO', 'fr')).body.kept).toBe(true);
    const listed = (await a.agent.get('/api/admin/library/books')).body.items.find((x: any) => x.id === b1.bookId);
    expect(listed).toMatchObject({ coverSource: 'AUTO', coverSourceFr: 'MANUAL' });

    // Removing the French cover leaves the English one.
    expect((await a.agent.delete(`/api/admin/library/books/${b1.bookId}/cover?language=fr`).set('X-CSRF-Token', a.csrf)).status).toBe(200);
    book = (await m.agent.get('/api/member/school')).body.books[0];
    expect(book.coverUrlFr).toBeNull();
    expect(book.coverUrl).not.toBeNull();
  });

  it('keeps the page count read when the PDF is uploaded', async () => {
    const a = await admin();
    const created = await post(a, '/api/admin/library/books', { kind: 'TRAINING', titleEn: 'Counted', trainingOrder: 1 });
    const auth = await post(a, `/api/admin/library/books/${created.body.id}/file/authorize`, { mimeType: 'application/pdf', byteSize: 1000 });
    vi.mocked(storage.headObject).mockResolvedValueOnce({ contentLength: 1000, contentType: 'application/pdf' });
    expect((await post(a, `/api/admin/library/books/${created.body.id}/file`, { storageKey: auth.body.storageKey, byteSize: 1000, pageCount: 84 })).status).toBe(200);
    const list = await a.agent.get('/api/admin/library/books');
    expect(list.body.items.find((b: any) => b.id === created.body.id)).toMatchObject({ pageCount: 84, chapterCount: 0, coverUrl: null });
    const m = await member('Counter');
    expect((await m.agent.get('/api/member/school')).body.books[0].pageCount).toBe(84);
  });

  it('chapters with summaries: written by the admin, in order, shown on the book page', async () => {
    const a = await admin();
    const b1 = await trainingBook(a, 1);
    const c1 = await post(a, `/api/admin/library/books/${b1.bookId}/chapters`, { titleEn: 'Called to serve', summaryEn: 'A leader first serves.', summaryFr: 'Un leader sert d’abord.' });
    const c2 = await post(a, `/api/admin/library/books/${b1.bookId}/chapters`, { titleEn: 'Faithful in little' });
    expect([c1.status, c2.status]).toEqual([201, 201]);
    expect([c1.body.order, c2.body.order]).toEqual([1, 2]);
    expect((await post(a, `/api/admin/library/books/${b1.bookId}/chapters`, { titleEn: '' })).status).toBe(400);

    expect((await post(a, `/api/admin/library/chapters/${c2.body.id}/move`, { direction: 'UP' })).status).toBe(200);
    const patched = await a.agent.patch(`/api/admin/library/chapters/${c2.body.id}`).set('X-CSRF-Token', a.csrf).send({ summaryEn: 'Small things first.' });
    expect(patched.body.summaryEn).toBe('Small things first.');

    const m = await member('Reader of summaries');
    const page = await m.agent.get(`/api/member/school/books/${b1.bookId}`);
    expect(page.status).toBe(200);
    expect(page.body.book).toMatchObject({ id: b1.bookId, chapterCount: 2, unlocked: false });
    expect(page.body.chapters.map((c: any) => c.titleEn)).toEqual(['Faithful in little', 'Called to serve']);
    expect(page.body.chapters[1]).toMatchObject({ summaryEn: 'A leader first serves.', summaryFr: 'Un leader sert d’abord.' });
    expect((await m.agent.get('/api/member/school')).body.books[0].chapterCount).toBe(2);

    expect((await a.agent.delete(`/api/admin/library/chapters/${c1.body.id}`).set('X-CSRF-Token', a.csrf)).status).toBe(200);
    expect((await m.agent.get(`/api/member/school/books/${b1.bookId}`)).body.chapters).toHaveLength(1);
    expect((await m.agent.get('/api/member/school/books/00000000-0000-0000-0000-000000000000')).status).toBe(404);
    // Members cannot write chapters.
    expect((await post(m, `/api/admin/library/books/${b1.bookId}/chapters`, { titleEn: 'Mine' })).status).toBe(401);
  });
});

describe('Reading bookmark and downloaded copies', () => {
  it('keeps where the reader stopped; a late save from an offline phone never goes backwards', async () => {
    const a = await admin();
    const b1 = await trainingBook(a, 1);
    const b2 = await trainingBook(a, 2);
    const m = await member('Bookmark Reader');
    await post(m, '/api/member/training/request');

    let info = await m.agent.get(`/api/member/library/books/${b1.bookId}`);
    expect(info.body.progress).toBeNull();
    expect(info.body.fileVersion).toMatch(/^[0-9a-f]{16}$/);

    const put = (bookId: string, body: Record<string, unknown>) => m.agent.put(`/api/member/library/books/${bookId}/progress`).set('X-CSRF-Token', m.csrf).send(body);
    expect((await put(b1.bookId, { page: 12, pageCount: 40 })).body.page).toBe(12);
    // Saved earlier on another phone without internet, sent only now: kept as it was.
    const late = await put(b1.bookId, { page: 3, at: new Date(Date.now() - 3600_000).toISOString() });
    expect(late.body).toMatchObject({ page: 12, kept: true });
    expect((await put(b1.bookId, { page: 0 })).status).toBe(400);

    info = await m.agent.get(`/api/member/library/books/${b1.bookId}`);
    expect(info.body.progress.page).toBe(12);
    const school = await m.agent.get('/api/member/school');
    expect(school.body.books[0].lastPage).toBe(12);
    // A book that isn't open for them: no bookmark.
    expect((await put(b2.bookId, { page: 2 })).status).toBe(404);
    expect(school.body.books[1].lastPage).toBeNull();
  });

  it('gives a new file version when the admin replaces the PDF, so phones download it again', async () => {
    const a = await admin();
    const b1 = await trainingBook(a, 1);
    const m = await member('Version Reader');
    await post(m, '/api/member/training/request');
    const v1 = (await m.agent.get(`/api/member/library/books/${b1.bookId}`)).body.fileVersion;
    await prisma.libraryBook.update({ where: { id: b1.bookId }, data: { storageKey: `library/${b1.bookId}/y.pdf` } });
    const v2 = (await m.agent.get(`/api/member/library/books/${b1.bookId}`)).body.fileVersion;
    expect(v2).not.toBe(v1);
  });
});
