import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';

vi.mock('../lib/storage', async () => {
  const actual = await vi.importActual<typeof import('../lib/storage')>('../lib/storage');
  return {
    ...actual,
    isStorageConfigured: () => true,
    headObject: vi.fn(async () => ({ contentLength: 1000, contentType: 'audio/webm' })),
  };
});

import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { generateStorageKey } from '../lib/attachmentPolicy';
import { bootstrap } from './testUtils';

// Teachings: posted in an assembly by the central admin's member profile;
// members read / listen, the system approves them, the quiz opens only then,
// and everyone in the assembly sees who finished and the scores.
const app = createApp();
const PASSWORD = 'GoodPass123!';
let n = 0;

function agentWithIp() {
  n += 1;
  const raw = request.agent(app);
  const ip = `10.141.${Math.floor(n / 256)}.${n % 256}`;
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const w = {} as Record<(typeof methods)[number], (p: string) => request.Test>;
  for (const m of methods) w[m] = (p: string) => raw[m](p).set('X-Forwarded-For', ip);
  return w;
}

async function signedIn(name: string, opts: { admin?: boolean; communityId?: string } = {}) {
  n += 1;
  const email = `teach${n}@example.com`;
  const person = await prisma.person.create({
    data: { name: `${name} ${n}`, whatsappNumber: `+2376570${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() },
  });
  await prisma.memberAccount.create({ data: { personId: person.id, email, passwordHash: await bcrypt.hash(PASSWORD, 4) } });
  if (opts.admin) await prisma.user.create({ data: { name: 'Central Admin', email: `teach-admin-${n}@test.local`, passwordHash: 'x', role: 'ADMIN', personId: person.id } });
  if (opts.communityId) await prisma.communityMembership.create({ data: { personId: person.id, communityId: opts.communityId, status: 'ACTIVE' } });

  const agent = agentWithIp();
  const { csrf } = await bootstrap(agent as any);
  if (opts.admin) {
    const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
    await agent.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email, password: PASSWORD });
    const code = spy.mock.calls[spy.mock.calls.length - 1][0].code as string;
    await agent.post('/api/member/auth/verify-code').set('X-CSRF-Token', csrf).send({ email, code });
    spy.mockRestore();
  } else {
    await agent.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email, password: PASSWORD });
  }
  return { person, agent, csrf };
}
type Who = Awaited<ReturnType<typeof signedIn>>;

const QUESTIONS = [
  { textEn: 'Who is the teaching about?', textFr: 'De qui parle l’enseignement ?', options: [{ textEn: 'Moses', isCorrect: false }, { textEn: 'Jesus', isCorrect: true }, { textEn: 'Paul', isCorrect: false }] },
  { textEn: 'Where did it happen?', options: [{ textEn: 'Galilee', isCorrect: true }, { textEn: 'Rome', isCorrect: false }] },
];

async function community(name = 'HQ Test') {
  return prisma.community.create({ data: { name: `${name} ${n++}` } });
}

async function postTeaching(admin: Who, communityId: string, extra: Record<string, unknown> = {}) {
  return admin.agent
    .post('/api/teachings')
    .set('X-CSRF-Token', admin.csrf)
    .send({ communityId, title: 'Walking in love', text: 'Love one another as I have loved you. '.repeat(12), questions: QUESTIONS, passMark: 50, openDays: 7, ...extra });
}

/** Pretends the member has had the page open long enough to have read it. */
async function openedLongAgo(teachingId: string, personId: string) {
  await prisma.teachingProgress.updateMany({ where: { teachingId, personId }, data: { openedAt: new Date(Date.now() - 5 * 60_000) } });
}

async function finishReading(who: Who, teachingId: string) {
  await who.agent.post(`/api/teachings/${teachingId}/progress`).set('X-CSRF-Token', who.csrf).send({});
  await openedLongAgo(teachingId, who.person.id);
  return who.agent.post(`/api/teachings/${teachingId}/progress`).set('X-CSRF-Token', who.csrf).send({ textRead: true });
}

async function takeQuiz(who: Who, assessmentId: string, rightAnswers: boolean) {
  const started = await who.agent.post(`/api/member/assessments/${assessmentId}/attempts`).set('X-CSRF-Token', who.csrf).send({});
  expect(started.status).toBe(201);
  const questions = await prisma.question.findMany({ where: { assessmentId }, include: { options: true }, orderBy: { order: 'asc' } });
  const answers = questions.map((q) => ({
    questionId: q.id,
    selectedOptionId: (q.options.find((o) => o.isCorrect === rightAnswers) ?? q.options[0]).id,
  }));
  return who.agent.post(`/api/member/attempts/${started.body.id}/submit`).set('X-CSRF-Token', who.csrf).send({ answers });
}

afterEach(() => vi.restoreAllMocks());

describe('Posting a teaching', () => {
  it('only the central admin can post; it appears in the assembly chat as a card', async () => {
    const c = await community();
    const admin = await signedIn('Coordinator', { admin: true });
    const member = await signedIn('Member', { communityId: c.id });

    const denied = await postTeaching(member, c.id);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('NOT_ALLOWED');

    const made = await postTeaching(admin, c.id);
    expect(made.status).toBe(201);

    const chat = await member.agent.get(`/api/communities/${c.id}/conversation/messages`);
    const item = chat.body.items.find((i: any) => i.id === made.body.messageId);
    expect(item.teaching).toMatchObject({ id: made.body.id, title: 'Walking in love', hasText: true, myState: 'NEW' });

    // Only the admin's profile is offered the "teaching" action.
    expect((await admin.agent.get(`/api/communities/${c.id}/conversation`)).body.canPostTeaching).toBe(true);
    expect((await member.agent.get(`/api/communities/${c.id}/conversation`)).body.canPostTeaching).toBe(false);
  });

  it('needs text or a file, and one correct answer per question', async () => {
    const c = await community();
    const admin = await signedIn('Coordinator', { admin: true });
    expect((await postTeaching(admin, c.id, { text: '' })).status).toBe(400);
    const twoRight = [{ textEn: 'Q?', options: [{ textEn: 'a', isCorrect: true }, { textEn: 'b', isCorrect: true }] }];
    expect((await postTeaching(admin, c.id, { questions: twoRight })).status).toBe(400);
    expect((await postTeaching(admin, c.id, { questions: [] })).status).toBe(400);
  });

  it('takes an audio as the message attachment', async () => {
    const c = await community();
    const admin = await signedIn('Coordinator', { admin: true });
    const member = await signedIn('Listener', { communityId: c.id });
    const attachment = { storageKey: generateStorageKey(c.id), originalFilename: 'teaching.webm', mimeType: 'audio/webm', byteSize: 1000 };
    const made = await postTeaching(admin, c.id, { attachment, text: '' });
    expect(made.status).toBe(201);
    const detail = await member.agent.get(`/api/teachings/${made.body.id}`);
    expect(detail.body.mediaKind).toBe('AUDIO');
    expect(detail.body.attachments).toHaveLength(1);
    expect(detail.body.messageId).toBe(made.body.messageId);
  });
});

describe('Reading, listening and the quiz', () => {
  it('the quiz stays locked until the system has seen the text read to the end; scrolling too fast does not count', async () => {
    const c = await community();
    const admin = await signedIn('Coordinator', { admin: true });
    const member = await signedIn('Reader', { communityId: c.id });
    const made = await postTeaching(admin, c.id);
    const { id, } = made.body;
    const assessmentId = (await prisma.teaching.findUniqueOrThrow({ where: { id } })).assessmentId;

    const before = await member.agent.get(`/api/teachings/${id}`);
    expect(before.body.quiz.state).toBe('LOCKED');
    expect((await member.agent.post(`/api/member/assessments/${assessmentId}/attempts`).set('X-CSRF-Token', member.csrf).send({})).status).toBe(409);

    // Straight to the bottom: not counted.
    const rushed = await member.agent.post(`/api/teachings/${id}/progress`).set('X-CSRF-Token', member.csrf).send({ textRead: true });
    expect(rushed.body.me.textRead).toBe(false);
    expect(rushed.body.quiz.state).toBe('LOCKED');
    // The reply carries everything the page needs to show the quiz.
    expect(rushed.body.quiz).toMatchObject({ assessmentId, passMark: 50, questionCount: 2 });

    // After a fair time on the page: approved, quiz open.
    const read = await finishReading(member, id);
    expect(read.body.me).toMatchObject({ textRead: true, completed: true });
    expect(read.body.quiz.state).toBe('AVAILABLE');
    expect((await member.agent.post(`/api/member/assessments/${assessmentId}/attempts`).set('X-CSRF-Token', member.csrf).send({})).status).toBe(201);
  });

  it('audio counts only once about 90% really played, and needs the text too when there is both', async () => {
    const c = await community();
    const admin = await signedIn('Coordinator', { admin: true });
    const member = await signedIn('Listener', { communityId: c.id });
    const attachment = { storageKey: generateStorageKey(c.id), originalFilename: 'a.webm', mimeType: 'audio/webm', byteSize: 1000 };
    const made = await postTeaching(admin, c.id, { attachment });
    const id = made.body.id;
    const progress = (body: object) => member.agent.post(`/api/teachings/${id}/progress`).set('X-CSRF-Token', member.csrf).send(body);

    await progress({});
    await openedLongAgo(id, member.person.id);
    expect((await progress({ mediaFraction: 0.5 })).body.me).toMatchObject({ mediaFraction: 0.5, mediaDone: false, completed: false });
    // Never goes backwards.
    expect((await progress({ mediaFraction: 0.2 })).body.me.mediaFraction).toBe(0.5);
    expect((await progress({ mediaFraction: 0.95 })).body.me).toMatchObject({ mediaDone: true, completed: false });
    const done = await progress({ textRead: true });
    expect(done.body.me.completed).toBe(true);
    expect(done.body.quiz.state).toBe('AVAILABLE');
  });

  it('everyone in the assembly sees who finished and each score, updating as others finish; the author is not counted', async () => {
    const c = await community();
    const admin = await signedIn('Coordinator', { admin: true });
    const ann = await signedIn('Ann', { communityId: c.id });
    const ben = await signedIn('Ben', { communityId: c.id });
    await signedIn('Cleo', { communityId: c.id });
    const outsider = await signedIn('Outsider');
    const made = await postTeaching(admin, c.id);
    const id = made.body.id;
    const assessmentId = (await prisma.teaching.findUniqueOrThrow({ where: { id } })).assessmentId;

    await finishReading(ann, id);
    const annResult = await takeQuiz(ann, assessmentId, true);
    expect(annResult.status).toBe(200);
    expect(annResult.body.passed).toBe(true);
    await finishReading(ben, id);

    // Ben sees the list with Ann's score (and himself as finished, no score yet).
    const list = await ben.agent.get(`/api/teachings/${id}/results`);
    expect(list.status).toBe(200);
    expect(list.body.totals).toMatchObject({ members: 3, opened: 2, finished: 2, taken: 1, passed: 1, averagePercentage: 100 });
    expect(list.body.participants.map((p: any) => [p.name.split(' ')[0], p.percentage, p.passed])).toEqual([
      ['Ann', 100, true],
      ['Ben', null, null],
    ]);
    // Everyone in the assembly also sees who is still pending (here: Cleo).
    expect(list.body.notFinished.map((m: any) => m.name.split(' ')[0])).toEqual(['Cleo']);

    // Ben fails his quiz: the list updates for everyone.
    const benResult = await takeQuiz(ben, assessmentId, false);
    expect(benResult.body.passed).toBe(false);
    const again = await ann.agent.get(`/api/teachings/${id}/results`);
    expect(again.body.totals).toMatchObject({ taken: 2, passed: 1, averagePercentage: 50 });
    expect(again.body.participants[1]).toMatchObject({ percentage: 0, passed: false });

    // The central admin sees the same pending list (and alone can send a reminder).
    const full = await admin.agent.get(`/api/teachings/${id}/results`);
    expect(full.body.notFinished.map((m: any) => m.name.split(' ')[0])).toEqual(['Cleo']);

    // One try only, and not for people outside the assembly.
    expect((await ann.agent.post(`/api/member/assessments/${assessmentId}/attempts`).set('X-CSRF-Token', ann.csrf).send({})).status).toBe(409);
    expect((await outsider.agent.get(`/api/teachings/${id}`)).status).toBe(404);
    expect((await outsider.agent.get(`/api/teachings/${id}/results`)).status).toBe(404);

    // Their card in the chat shows where each one is.
    const chat = await ann.agent.get(`/api/communities/${c.id}/conversation/messages`);
    expect(chat.body.items.find((i: any) => i.id === made.body.messageId).teaching).toMatchObject({ myState: 'PASSED', myPercentage: 100, totals: { taken: 2, passed: 1 } });
    expect(chat.body.items.find((i: any) => i.id === made.body.messageId).teaching.totals.members).toBe(3);
    const top = chat.body.items.find((i: any) => i.id === made.body.messageId).teaching.totals.top;
    expect(top.map((p: any) => p.percentage)).toEqual([100, 0]);
    expect(top[0]).toMatchObject({ passed: true });
  });

  it('closes after the open days: no new quiz, results stay', async () => {
    const c = await community();
    const admin = await signedIn('Coordinator', { admin: true });
    const member = await signedIn('Late', { communityId: c.id });
    const made = await postTeaching(admin, c.id);
    const t = await prisma.teaching.findUniqueOrThrow({ where: { id: made.body.id } });
    await finishReading(member, t.id);
    await prisma.teaching.update({ where: { id: t.id }, data: { closesAt: new Date(Date.now() - 1000) } });
    expect((await member.agent.get(`/api/teachings/${t.id}`)).body.quiz.state).toBe('CLOSED');
    expect((await member.agent.post(`/api/member/assessments/${t.assessmentId}/attempts`).set('X-CSRF-Token', member.csrf).send({})).status).toBe(409);
    expect((await member.agent.get(`/api/teachings/${t.id}/results`)).status).toBe(200);
  });

  it('a deleted teaching message makes the teaching disappear', async () => {
    const c = await community();
    const admin = await signedIn('Coordinator', { admin: true });
    const member = await signedIn('Member', { communityId: c.id });
    const made = await postTeaching(admin, c.id);
    await prisma.message.update({ where: { id: made.body.messageId }, data: { deletedAt: new Date() } });
    expect((await member.agent.get(`/api/teachings/${made.body.id}`)).status).toBe(404);
  });
});

describe('Reminders and question drafting', () => {
  it('the admin can remind those who have not finished, but not twice in a row; members cannot', async () => {
    const c = await community();
    const admin = await signedIn('Coordinator', { admin: true });
    const member = await signedIn('Member', { communityId: c.id });
    const made = await postTeaching(admin, c.id);
    expect((await member.agent.post(`/api/teachings/${made.body.id}/remind`).set('X-CSRF-Token', member.csrf).send({})).status).toBe(403);
    const first = await admin.agent.post(`/api/teachings/${made.body.id}/remind`).set('X-CSRF-Token', admin.csrf).send({});
    expect(first.status).toBe(200);
    expect(first.body.sent).toBe(1);
    expect((await admin.agent.post(`/api/teachings/${made.body.id}/remind`).set('X-CSRF-Token', admin.csrf).send({})).status).toBe(429);
  });

  it('drafting is for the admin only, and says so when the assistant is not set up', async () => {
    const c = await community();
    const admin = await signedIn('Coordinator', { admin: true });
    const member = await signedIn('Member', { communityId: c.id });
    expect((await member.agent.post('/api/teachings/draft-questions').set('X-CSRF-Token', member.csrf).send({ communityId: c.id, text: 'Hello' })).status).toBe(403);
    const res = await admin.agent.post('/api/teachings/draft-questions').set('X-CSRF-Token', admin.csrf).send({ communityId: c.id, text: 'Hello' });
    // No Gemini key in the test environment.
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('AI_OFF');
  });
});
