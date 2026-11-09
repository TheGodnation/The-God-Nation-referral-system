import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';

vi.mock('../lib/storage', () => ({
  isStorageConfigured: vi.fn(() => true),
  createUploadUrl: vi.fn(async ({ storageKey }: { storageKey: string }) => ({ url: `https://mock-r2.example/upload/${storageKey}`, expiresAt: new Date(Date.now() + 300000) })),
  createDownloadUrl: vi.fn(async ({ storageKey }: { storageKey: string }) => ({ url: `https://mock-r2.example/download/${storageKey}`, expiresAt: new Date(Date.now() + 300000) })),
  headObject: vi.fn(async () => null),
}));

import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';

// Faith journey: the personal "Section C" of the Book 1 / Book 2 exams.
// Never marked, always required, never shown to members; the central admin
// (and, when he allows it, the person's leaders) read it to talk with people.

const app = createApp();

let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.131.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', ip);
  return wrapped;
}
type Agent = ReturnType<typeof agentWithUniqueIp>;
type Who = { agent: Agent; csrf: string; id: string };

let n = 0;
async function member(name: string): Promise<Who> {
  n += 1;
  const whatsapp = `+2376751${String(n).padStart(5, '0')}`;
  const person = await prisma.person.create({ data: { name, whatsappNumber: whatsapp } });
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  const ra = agentWithUniqueIp();
  const { csrf: rc } = await bootstrap(ra as any);
  await ra.post('/api/member/auth/request-link').set('X-CSRF-Token', rc).send({ whatsapp, email: `faith${n}@example.com` });
  const link = spy.mock.calls[spy.mock.calls.length - 1][0].link as string;
  spy.mockRestore();
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/member/auth/consume').set('X-CSRF-Token', csrf).send({ token: new URL(link).searchParams.get('token') });
  return { agent, csrf, id: person.id };
}

async function admin() {
  n += 1;
  const email = `faith-admin-${n}@test.local`;
  const user = await createAdmin(email, 'AdminPass123!');
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'AdminPass123!' });
  return { agent, csrf, user };
}

const post = (who: { agent: Agent; csrf: string }, path: string, body: Record<string, unknown> = {}) => who.agent.post(path).set('X-CSRF-Token', who.csrf).send(body);
const put = (who: { agent: Agent; csrf: string }, path: string, body: Record<string, unknown> = {}) => who.agent.put(path).set('X-CSRF-Token', who.csrf).send(body);

/** Book 1 with a published one-set exam: one marked question, and the personal questions of the real exam in miniature. */
async function bookOneExam(a: { agent: Agent; csrf: string }) {
  const res = await post(a, '/api/admin/library/books', { kind: 'TRAINING', titleEn: 'Restoration', trainingOrder: 1 });
  expect(res.status).toBe(201);
  await prisma.libraryBook.update({ where: { id: res.body.id }, data: { storageKey: `library/${res.body.id}/x.pdf`, byteSize: 13 } });
  const exam = (await prisma.assessment.findUnique({ where: { trainingBookId: res.body.id } }))!;
  const q = await prisma.question.create({ data: { assessmentId: exam.id, textEn: 'Marked', order: 0, points: 1, setNumber: 1 } });
  await prisma.option.create({ data: { questionId: q.id, textEn: 'Right', isCorrect: true, order: 0 } });
  await prisma.option.create({ data: { questionId: q.id, textEn: 'Wrong', isCorrect: false, order: 1 } });

  const choice = async (order: number, text: string, opts: [string, 'POSITIVE' | 'NEEDS_TALK'][], extra: Record<string, unknown> = {}) => {
    const pq = await prisma.personalQuestion.create({ data: { assessmentId: exam.id, setNumber: 1, order, kind: 'CHOICE', textEn: text, textFr: `${text} (fr)`, guideEn: `Guide for ${text}`, ...extra } });
    for (const [i, [t, signal]] of opts.entries()) await prisma.personalOption.create({ data: { questionId: pq.id, order: i, textEn: t, textFr: `${t} (fr)`, signal } });
    return pq;
  };
  const born = await choice(0, 'Born again?', [['Yes, I am', 'POSITIVE'], ['Not sure', 'NEEDS_TALK'], ['No', 'NEEDS_TALK']]);
  const reading = await choice(1, 'Reading the Word?', [['Every day', 'POSITIVE'], ['Not yet', 'NEEDS_TALK']], { affectsStatus: false });
  const holdingBack = await prisma.personalQuestion.create({ data: { assessmentId: exam.id, setNumber: 1, order: 2, kind: 'TEXT', textEn: 'What holds you back? (write "nothing")', guideEn: 'Read with care', flagUnlessNone: true } });
  const confession = await choice(3, 'My Confession of Faith', [['I agree', 'POSITIVE'], ['I do not agree', 'NEEDS_TALK']], { bodyEn: 'I confess Jesus Christ as Lord.' });
  const optionsOf = async (id: string) => (await prisma.personalOption.findMany({ where: { questionId: id }, orderBy: { order: 'asc' } })).map((o) => o.id);
  await prisma.assessment.update({ where: { id: exam.id }, data: { status: 'PUBLISHED' } });
  return {
    bookId: res.body.id as string,
    examId: exam.id,
    ids: { born: born.id, reading: reading.id, holdingBack: holdingBack.id, confession: confession.id },
    options: { born: await optionsOf(born.id), reading: await optionsOf(reading.id), confession: await optionsOf(confession.id) },
  };
}

type Setup = Awaited<ReturnType<typeof bookOneExam>>;

/** Starts a try and submits the marked question right, with the given personal answers. */
async function takeExam(m: Who, s: Setup, personal: Record<string, unknown>[] | null) {
  const start = await post(m, `/api/member/assessments/${s.examId}/attempts`);
  expect([200, 201]).toContain(start.status);
  const qs = await m.agent.get(`/api/member/attempts/${start.body.id}/questions`);
  const answers = qs.body.questions.map((q: any) => ({ questionId: q.id, selectedOptionId: q.options.find((o: any) => o.textEn === 'Right').id }));
  const submit = await post(m, `/api/member/attempts/${start.body.id}/submit`, personal === null ? { answers } : { answers, personal });
  return { start, qs, submit };
}

const goodAnswers = (s: Setup) => [
  { questionId: s.ids.born, optionId: s.options.born[0] },
  { questionId: s.ids.reading, optionId: s.options.reading[0] },
  { questionId: s.ids.holdingBack, text: 'Nothing' },
  { questionId: s.ids.confession, optionId: s.options.confession[0] },
];

async function student(a: { agent: Agent; csrf: string }, name: string) {
  const m = await member(name);
  await post(a, '/api/admin/library/trainees', { personId: m.id });
  return m;
}

afterEach(() => vi.clearAllMocks());

describe('Faith journey: the personal section of a book exam', () => {
  it('shows the personal questions without their signals or guide, and refuses to finish until all are answered', async () => {
    const a = await admin();
    const s = await bookOneExam(a);
    const m = await student(a, 'Answering person');

    const start = await post(m, `/api/member/assessments/${s.examId}/attempts`);
    const qs = await m.agent.get(`/api/member/attempts/${start.body.id}/questions`);
    expect(qs.body.personalQuestions.map((q: any) => q.textEn)).toEqual(['Born again?', 'Reading the Word?', 'What holds you back? (write "nothing")', 'My Confession of Faith']);
    const confession = qs.body.personalQuestions[3];
    expect(confession).toMatchObject({ kind: 'CHOICE', bodyEn: 'I confess Jesus Christ as Lord.', required: true });
    expect(JSON.stringify(qs.body.personalQuestions)).not.toMatch(/signal|guide|affectsStatus|flagUnlessNone/);

    const marked = qs.body.questions.map((q: any) => ({ questionId: q.id, selectedOptionId: q.options.find((o: any) => o.textEn === 'Right').id }));
    // Nothing at all, then a missing question, then blank words: all refused, and the try stays open.
    const none = await post(m, `/api/member/attempts/${start.body.id}/submit`, { answers: marked });
    expect(none.status).toBe(400);
    expect(none.body.code).toBe('PERSONAL_REQUIRED');
    expect(none.body.missing).toHaveLength(4);
    const partial = await post(m, `/api/member/attempts/${start.body.id}/submit`, { answers: marked, personal: goodAnswers(s).slice(0, 3) });
    expect(partial.body.missing).toEqual([s.ids.confession]);
    const blank = await post(m, `/api/member/attempts/${start.body.id}/submit`, { answers: marked, personal: [...goodAnswers(s).slice(0, 2), { questionId: s.ids.holdingBack, text: '   ' }, goodAnswers(s)[3]] });
    expect(blank.body.missing).toEqual([s.ids.holdingBack]);
    expect((await prisma.attempt.findUnique({ where: { id: start.body.id } }))!.status).toBe('IN_PROGRESS');

    // A choice that belongs to another question is not an answer.
    const foreign = await post(m, `/api/member/attempts/${start.body.id}/submit`, { answers: marked, personal: [{ ...goodAnswers(s)[0], optionId: s.options.confession[0] }, ...goodAnswers(s).slice(1)] });
    expect(foreign.body.code).toBe('PERSONAL_REQUIRED');

    const done = await post(m, `/api/member/attempts/${start.body.id}/submit`, { answers: marked, personal: goodAnswers(s) });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ score: 1, maxScore: 1, passed: true });
    // The member never sees the answers back.
    expect(JSON.stringify(done.body)).not.toMatch(/personal|faith|guide/i);
  });

  it('records the answers as they were worded, and "born again" when every deciding answer is a clear yes', async () => {
    const a = await admin();
    const s = await bookOneExam(a);
    const m = await student(a, 'Born again person');
    const { start, submit } = await takeExam(m, s, goodAnswers(s));
    expect(submit.status).toBe(200);

    const rows = await prisma.personalAnswer.findMany({ where: { attemptId: start.body.id }, orderBy: { order: 'asc' } });
    expect(rows.map((r) => [r.questionEn, r.answerEn, r.signal])).toEqual([
      ['Born again?', 'Yes, I am', 'POSITIVE'],
      ['Reading the Word?', 'Every day', 'POSITIVE'],
      ['What holds you back? (write "nothing")', 'Nothing', 'POSITIVE'],
      ['My Confession of Faith', 'I agree', 'POSITIVE'],
    ]);
    expect(rows[0]).toMatchObject({ personId: m.id, guideEn: 'Guide for Born again?', answerFr: 'Yes, I am (fr)', questionFr: 'Born again? (fr)' });
    const record = await prisma.faithRecord.findUnique({ where: { personId: m.id } });
    expect(record).toMatchObject({ status: 'BORN_AGAIN', lastAttemptId: start.body.id, confirmedAt: null });
    // Nothing to worry about, so nobody is notified.
    expect(await prisma.notification.count({ where: { type: 'FAITH_NEEDS_CONVERSATION' } })).toBe(0);
  });

  it('never changes pass or fail: a person who says "not yet" still passes, and the central admin is told once', async () => {
    const a = await admin();
    const s = await bookOneExam(a);
    const m = await student(a, 'Needs a talk');
    const { submit } = await takeExam(m, s, [
      { questionId: s.ids.born, optionId: s.options.born[1] },
      { questionId: s.ids.reading, optionId: s.options.reading[0] },
      { questionId: s.ids.holdingBack, text: 'nothing' },
      { questionId: s.ids.confession, optionId: s.options.confession[1] },
    ]);
    expect(submit.body).toMatchObject({ score: 1, maxScore: 1, passed: true });
    expect((await prisma.faithRecord.findUnique({ where: { personId: m.id } }))!.status).toBe('NEEDS_CONVERSATION');
    const told = await prisma.notification.findMany({ where: { type: 'FAITH_NEEDS_CONVERSATION' } });
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ recipientUserId: a.user.id, targetType: 'FaithJourney', targetId: m.id });
    expect(told[0].metadata).toMatchObject({ personName: 'Needs a talk', bookNumber: 1 });
  });

  it('only the questions about salvation decide the status; words typed after "holding back" call for a talk unless they say nothing', async () => {
    const a = await admin();
    const s = await bookOneExam(a);

    const reading = await student(a, 'Not reading yet');
    await takeExam(reading, s, [
      { questionId: s.ids.born, optionId: s.options.born[0] },
      { questionId: s.ids.reading, optionId: s.options.reading[1] }, // flagged, but not a salvation question
      { questionId: s.ids.holdingBack, text: 'None.' },
      { questionId: s.ids.confession, optionId: s.options.confession[0] },
    ]);
    expect((await prisma.faithRecord.findUnique({ where: { personId: reading.id } }))!.status).toBe('BORN_AGAIN');
    const flagged = await prisma.personalAnswer.findMany({ where: { personId: reading.id, signal: 'NEEDS_TALK' } });
    expect(flagged.map((r) => r.answerEn)).toEqual(['Not yet']);

    const held = await student(a, 'Held back');
    await takeExam(held, s, [
      { questionId: s.ids.born, optionId: s.options.born[0] },
      { questionId: s.ids.reading, optionId: s.options.reading[0] },
      { questionId: s.ids.holdingBack, text: 'My family would not accept it' },
      { questionId: s.ids.confession, optionId: s.options.confession[0] },
    ]);
    expect((await prisma.faithRecord.findUnique({ where: { personId: held.id } }))!.status).toBe('NEEDS_CONVERSATION');
  });

  it('a retake with new answers updates where the person stands and keeps the whole history', async () => {
    const a = await admin();
    const s = await bookOneExam(a);
    const m = await student(a, 'Journey');
    await takeExam(m, s, [
      { questionId: s.ids.born, optionId: s.options.born[2] },
      { questionId: s.ids.reading, optionId: s.options.reading[1] },
      { questionId: s.ids.holdingBack, text: 'Fear' },
      { questionId: s.ids.confession, optionId: s.options.confession[1] },
    ]);
    const first = await prisma.attempt.findFirst({ where: { personId: m.id } });
    expect((await prisma.faithRecord.findUnique({ where: { personId: m.id } }))!.status).toBe('NEEDS_CONVERSATION');

    // A second try of the same set (the exam has one set; it was already passed, so create the try directly).
    const second = await prisma.attempt.create({ data: { personId: m.id, assessmentId: s.examId, attemptNumber: 2, setNumber: 1, status: 'SUBMITTED', submittedAt: new Date(), score: 1, maxScore: 1, percentage: 100, passed: true, passMarkAtAttempt: 70 } });
    expect(second.id).not.toBe(first!.id);
    const { savePersonalAnswers, recordFaith, personalQuestionsFor, prepareAnswers } = await import('../lib/faith');
    const questions = await personalQuestionsFor(s.examId, 1);
    const prepared = prepareAnswers(questions, goodAnswers(s));
    await savePersonalAnswers(second, prepared);
    await recordFaith(second, questions, prepared);

    expect((await prisma.faithRecord.findUnique({ where: { personId: m.id } }))!.status).toBe('BORN_AGAIN');
    const journey = await a.agent.get(`/api/admin/faith/${m.id}`);
    expect(journey.body.tries).toHaveLength(2);
    expect(journey.body.tries.map((t: any) => t.attemptNumber)).toEqual([2, 1]);
    expect(journey.body.tries[1].answers.map((x: any) => x.answerEn)).toEqual(['No', 'Not yet', 'Fear', 'I do not agree']);
  });
});

describe('Faith journey: who may read it', () => {
  async function twoPeople() {
    const a = await admin();
    const s = await bookOneExam(a);
    const needs = await student(a, 'Needs conversation');
    await takeExam(needs, s, [
      { questionId: s.ids.born, optionId: s.options.born[1] },
      { questionId: s.ids.reading, optionId: s.options.reading[0] },
      { questionId: s.ids.holdingBack, text: 'nothing' },
      { questionId: s.ids.confession, optionId: s.options.confession[0] },
    ]);
    const fine = await student(a, 'Already born again');
    await takeExam(fine, s, goodAnswers(s));
    return { a, s, needs, fine };
  }

  it('the central admin reads the list and each journey (with the teacher guide), filters, confirms, and writes notes', async () => {
    const { a, needs, fine } = await twoPeople();
    const all = await a.agent.get('/api/admin/faith');
    expect(all.body.items.map((i: any) => [i.name, i.status]).sort()).toEqual([['Already born again', 'BORN_AGAIN'], ['Needs conversation', 'NEEDS_CONVERSATION']]);
    expect((await a.agent.get('/api/admin/faith?filter=NEEDS')).body.items.map((i: any) => i.name)).toEqual(['Needs conversation']);
    expect((await a.agent.get('/api/admin/faith?filter=BORN_AGAIN')).body.items.map((i: any) => i.name)).toEqual(['Already born again']);
    expect((await a.agent.get('/api/admin/faith?search=needs')).body.items).toHaveLength(1);

    const journey = await a.agent.get(`/api/admin/faith/${needs.id}`);
    expect(journey.status).toBe(200);
    expect(journey.body).toMatchObject({ status: 'NEEDS_CONVERSATION', person: { name: 'Needs conversation' } });
    expect(journey.body.tries[0]).toMatchObject({ book: { number: 1 }, setNumber: 1, passed: true });
    expect(journey.body.tries[0].answers[0]).toMatchObject({ questionEn: 'Born again?', answerEn: 'Not sure', signal: 'NEEDS_TALK', guideEn: 'Guide for Born again?' });

    // After speaking with him: a private note, and "confirmed". He then leaves the "needs a conversation" list.
    const note = await post(a, `/api/admin/faith/${needs.id}/notes`, { text: 'Spoke on the phone; he wants to pray on Sunday.' });
    expect(note.status).toBe(201);
    expect(note.body.notes[0]).toMatchObject({ authorName: a.user.name, text: 'Spoke on the phone; he wants to pray on Sunday.' });
    expect((await post(a, `/api/admin/faith/${needs.id}/notes`, { text: '  ' })).status).toBe(400);
    const confirmed = await post(a, `/api/admin/faith/${needs.id}/confirm`, { confirmed: true });
    expect(confirmed.body).toMatchObject({ status: 'NEEDS_CONVERSATION', confirmedByName: a.user.name });
    expect(confirmed.body.confirmedAt).not.toBeNull();
    expect((await a.agent.get('/api/admin/faith?filter=NEEDS')).body.items).toHaveLength(0);
    expect((await a.agent.get('/api/admin/faith?filter=CONFIRMED')).body.items.map((i: any) => i.name)).toEqual(['Needs conversation']);
    expect((await post(a, `/api/admin/faith/${needs.id}/confirm`, { confirmed: false })).body.confirmedAt).toBeNull();
    expect((await a.agent.get(`/api/admin/faith/${fine.id}/exists`)).body).toMatchObject({ exists: true, status: 'BORN_AGAIN' });
    expect((await a.agent.get('/api/admin/faith/00000000-0000-0000-0000-000000000000')).status).toBe(404);
  });

  it('the central admin on his member profile reaches the same journeys; an ordinary member reaches nothing, not even their own', async () => {
    const { a, needs } = await twoPeople();
    const me = await member('Admin as member');
    await prisma.user.update({ where: { id: a.user.id }, data: { personId: me.id } });
    expect((await me.agent.get('/api/member/faith/access')).body).toMatchObject({ role: 'ADMIN', canRead: true });
    expect((await me.agent.get('/api/member/faith')).body.items).toHaveLength(2);
    expect((await me.agent.get(`/api/member/faith/${needs.id}`)).status).toBe(200);
    expect((await post(me, `/api/member/faith/${needs.id}/notes`, { text: 'From my profile' })).status).toBe(201);

    expect((await needs.agent.get('/api/member/faith/access')).status).toBe(403);
    expect((await needs.agent.get('/api/member/faith')).status).toBe(403);
    expect((await needs.agent.get(`/api/member/faith/${needs.id}`)).status).toBe(404);
    expect((await needs.agent.get(`/api/member/faith/${needs.id}/exists`)).body.exists).toBe(false);
    expect((await put(needs, '/api/member/faith/settings', { leadersSeeFaithJourney: true })).status).toBe(403);
  });

  it('leaders see nothing until the switch is on, then only the people of their own assembly (and are told when someone needs a talk)', async () => {
    const { a, s, needs, fine } = await twoPeople();
    const group = await prisma.community.create({ data: { name: 'Faith group' } });
    const other = await prisma.community.create({ data: { name: 'Other group' } });
    await prisma.communityMembership.create({ data: { personId: needs.id, communityId: group.id } });
    await prisma.communityMembership.create({ data: { personId: fine.id, communityId: other.id } });
    const leader = await member('Group leader');
    await prisma.roleAssignment.create({ data: { personId: leader.id, roleType: 'SCOPED_LEADER', communityId: group.id, assignedByUserId: a.user.id } });

    // Switch off (the starting state): a leader can see that he is one, but reads nothing.
    expect((await leader.agent.get('/api/member/faith/access')).body).toMatchObject({ role: 'LEADER', leadersSee: false, canRead: false });
    expect((await leader.agent.get('/api/member/faith')).body.items).toEqual([]);
    expect((await leader.agent.get(`/api/member/faith/${needs.id}`)).status).toBe(404);

    expect((await a.agent.get('/api/admin/faith/settings')).body).toEqual({ leadersSeeFaithJourney: false });
    expect((await put(a, '/api/admin/faith/settings', { leadersSeeFaithJourney: true })).body).toEqual({ leadersSeeFaithJourney: true });
    expect(await prisma.auditLog.findFirst({ where: { action: 'FAITH_LEADERS_SWITCHED' } })).not.toBeNull();

    expect((await leader.agent.get('/api/member/faith/access')).body).toMatchObject({ canRead: true });
    expect((await leader.agent.get('/api/member/faith')).body.items.map((i: any) => i.name)).toEqual(['Needs conversation']);
    expect((await leader.agent.get(`/api/member/faith/${needs.id}`)).status).toBe(200);
    expect(await prisma.auditLog.findFirst({ where: { action: 'FAITH_VIEWED_BY_LEADER', targetId: needs.id } })).not.toBeNull();
    // A person of another assembly stays closed to him, and so does the switch itself.
    expect((await leader.agent.get(`/api/member/faith/${fine.id}`)).status).toBe(404);
    expect((await put(leader, '/api/member/faith/settings', { leadersSeeFaithJourney: false })).status).toBe(403);
    // He may write a note and confirm, under his own name.
    expect((await post(leader, `/api/member/faith/${needs.id}/notes`, { text: 'Visited at home.' })).body.notes[0].authorName).toBe('Group leader');
    expect((await post(leader, `/api/member/faith/${needs.id}/confirm`, { confirmed: true })).body.confirmedByName).toBe('Group leader');

    // With the switch on, a new answer that calls for a talk also reaches the leader.
    const another = await student(a, 'Newcomer');
    await prisma.communityMembership.create({ data: { personId: another.id, communityId: group.id } });
    await takeExam(another, s, [
      { questionId: s.ids.born, optionId: s.options.born[2] },
      { questionId: s.ids.reading, optionId: s.options.reading[0] },
      { questionId: s.ids.holdingBack, text: 'nothing' },
      { questionId: s.ids.confession, optionId: s.options.confession[1] },
    ]);
    expect(await prisma.notification.count({ where: { type: 'FAITH_NEEDS_CONVERSATION', recipientPersonId: leader.id, targetId: another.id } })).toBe(1);
    // Switching it off closes it again.
    await put(a, '/api/admin/faith/settings', { leadersSeeFaithJourney: false });
    expect((await leader.agent.get(`/api/member/faith/${needs.id}`)).status).toBe(404);
  });

  it('the central admin sees the personal questions of each set, with signals and guide, in the exam editor', async () => {
    const a = await admin();
    const s = await bookOneExam(a);
    const detail = await a.agent.get(`/api/admin/assessments/${s.examId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.personalQuestions.map((q: any) => [q.setNumber, q.order, q.kind, q.textEn])).toEqual([
      [1, 0, 'CHOICE', 'Born again?'],
      [1, 1, 'CHOICE', 'Reading the Word?'],
      [1, 2, 'TEXT', 'What holds you back? (write "nothing")'],
      [1, 3, 'CHOICE', 'My Confession of Faith'],
    ]);
    expect(detail.body.personalQuestions[0]).toMatchObject({ guideEn: 'Guide for Born again?', affectsStatus: true });
    expect(detail.body.personalQuestions[0].options.map((o: any) => [o.textEn, o.signal])).toEqual([['Yes, I am', 'POSITIVE'], ['Not sure', 'NEEDS_TALK'], ['No', 'NEEDS_TALK']]);
  });

  it('is deleted with the person', async () => {
    const { needs } = await twoPeople();
    expect(await prisma.personalAnswer.count({ where: { personId: needs.id } })).toBe(4);
    await prisma.person.delete({ where: { id: needs.id } });
    expect(await prisma.personalAnswer.count({ where: { personId: needs.id } })).toBe(0);
    expect(await prisma.faithRecord.count({ where: { personId: needs.id } })).toBe(0);
  });

  it('an exam without personal questions works exactly as before', async () => {
    const a = await admin();
    const res = await post(a, '/api/admin/library/books', { kind: 'TRAINING', titleEn: 'Book two', trainingOrder: 2 });
    const exam = (await prisma.assessment.findUnique({ where: { trainingBookId: res.body.id } }))!;
    const q = await prisma.question.create({ data: { assessmentId: exam.id, textEn: 'Q', order: 0, points: 1, setNumber: 1 } });
    const right = await prisma.option.create({ data: { questionId: q.id, textEn: 'Right', isCorrect: true, order: 0 } });
    await prisma.option.create({ data: { questionId: q.id, textEn: 'Wrong', isCorrect: false, order: 1 } });
    await prisma.assessment.update({ where: { id: exam.id }, data: { status: 'PUBLISHED' } });
    // Book 2 opens after Book 1: open it for the student directly.
    const m = await student(a, 'Plain exam');
    await prisma.trainingBookOpen.create({ data: { personId: m.id, bookId: res.body.id } });
    const start = await post(m, `/api/member/assessments/${exam.id}/attempts`);
    expect([200, 201]).toContain(start.status);
    const qs = await m.agent.get(`/api/member/attempts/${start.body.id}/questions`);
    expect(qs.body.personalQuestions).toEqual([]);
    const done = await post(m, `/api/member/attempts/${start.body.id}/submit`, { answers: [{ questionId: q.id, selectedOptionId: right.id }] });
    expect(done.status).toBe(200);
    expect(await prisma.faithRecord.count({ where: { personId: m.id } })).toBe(0);
  });
});
