import { describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createAdmin, createLeader } from './helpers';
import { bootstrap } from './testUtils';

// The admin Results page: every submitted quiz / exam try in one list
// (teaching quizzes, book exams, devotional exams), searchable by person,
// downloadable as a spreadsheet, plus a member's own teaching-quiz list.
const RUN = Math.random().toString(36).slice(2, 8);
const app = createApp();
let n = 0;

function agentWithIp() {
  n += 1;
  const ip = `10.152.${Math.floor(n / 256) % 256}.${n % 256}`;
  const raw = request.agent(app);
  const methods = ['get', 'post'] as const;
  const w = {} as Record<(typeof methods)[number], (p: string) => request.Test>;
  for (const m of methods) w[m] = (p: string) => raw[m](p).set('X-Forwarded-For', ip);
  return w;
}

async function admin() {
  const email = `results-admin-${RUN}-${n}@test.local`;
  await createAdmin(email, 'AdminPass123!');
  const agent = agentWithIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'AdminPass123!' });
  return agent;
}

async function person(name: string) {
  n += 1;
  return prisma.person.create({ data: { name, whatsappNumber: `+2376580${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() } });
}

async function attempt(personId: string, assessmentId: string, percentage: number, passed: boolean, submittedAt = new Date()) {
  return prisma.attempt.create({
    data: { personId, assessmentId, attemptNumber: 1, status: 'SUBMITTED', submittedAt, score: percentage / 10, maxScore: 10, percentage, passMarkAtAttempt: 50, passed },
  });
}

async function seed() {
  const community = await prisma.community.create({ data: { name: `Results Assembly ${RUN}${n++}` } });
  const conv = await prisma.conversation.create({ data: { communityId: community.id } });
  const author = await person(`Teacher ${RUN}`);
  const message = await prisma.message.create({ data: { conversationId: conv.id, senderPersonId: author.id, body: 'Walking in love' } });
  const teachingQuiz = await prisma.assessment.create({ data: { titleEn: 'Teaching quiz: Walking in love', passMark: 50, status: 'PUBLISHED' } });
  await prisma.teaching.create({
    data: { communityId: community.id, messageId: message.id, assessmentId: teachingQuiz.id, authorPersonId: author.id, title: 'Walking in love', text: 'x', closesAt: new Date(Date.now() + 86_400_000) },
  });
  const book = await prisma.libraryBook.create({ data: { kind: 'TRAINING', titleEn: `Book of Faith ${RUN}` } });
  const bookExam = await prisma.assessment.create({ data: { titleEn: 'Book exam', passMark: 50, status: 'PUBLISHED', trainingBookId: book.id } });
  const devotional = await prisma.monthlyDevotional.create({ data: { titleEn: `October ${RUN}`, contentEn: 'c', startDate: new Date(), endDate: new Date() } });
  const week = await prisma.assessment.create({ data: { titleEn: 'Week 2', passMark: 50, status: 'PUBLISHED', devotionalId: devotional.id, weekNumber: 2 } });

  const marie = await person(`Marie Ngo ${RUN}`);
  const paul = await person(`=Evil Paul ${RUN}`);
  await prisma.communityMembership.create({ data: { personId: marie.id, communityId: community.id, status: 'ACTIVE' } });
  await attempt(marie.id, teachingQuiz.id, 80, true, new Date('2026-10-28T10:00:00Z'));
  await attempt(marie.id, bookExam.id, 40, false, new Date('2026-10-20T10:00:00Z'));
  await attempt(paul.id, week.id, 90, true, new Date('2026-10-10T10:00:00Z'));
  // An unfinished try is not a result.
  await prisma.attempt.create({ data: { personId: paul.id, assessmentId: teachingQuiz.id, attemptNumber: 1, status: 'IN_PROGRESS' } });
  return { community, marie, paul };
}

describe('Admin Results — every quiz and exam try in one place', () => {
  it('lists teaching quizzes, book exams and devotional exams with titles, and finds a person by name', async () => {
    const { marie } = await seed();
    const a = await admin();

    const all = await a.get(`/api/admin/results?search=${RUN}`);
    expect(all.status).toBe(200);
    expect(all.body.pagination.total).toBe(3);
    expect(all.body.items[0]).toMatchObject({ personName: `Marie Ngo ${RUN}`, kind: 'TEACHING', title: 'Walking in love', percentage: 80, passed: true });
    const kinds = all.body.items.map((r: any) => [r.kind, r.title]);
    expect(kinds).toContainEqual(['BOOK', `Book of Faith ${RUN}`]);
    expect(kinds).toContainEqual(['DEVOTIONAL', `October ${RUN} — week 2`]);

    const hers = await a.get(`/api/admin/results?personId=${marie.id}`);
    expect(hers.body.pagination.total).toBe(2);
    const byName = await a.get(`/api/admin/results?search=${encodeURIComponent(`Marie Ngo ${RUN}`)}`);
    expect(byName.body.pagination.total).toBe(2);
  });

  it('filters by kind, assembly and dates', async () => {
    const { community } = await seed();
    const a = await admin();
    const teaching = await a.get(`/api/admin/results?kind=TEACHING&search=${RUN}`);
    expect(teaching.body.items.every((r: any) => r.kind === 'TEACHING')).toBe(true);
    expect((await a.get(`/api/admin/results?kind=BOOK&search=${RUN}`)).body.pagination.total).toBeGreaterThanOrEqual(1);
    const inAssembly = await a.get(`/api/admin/results?communityId=${community.id}`);
    expect(inAssembly.body.pagination.total).toBe(2);
    const october = await a.get(`/api/admin/results?search=${RUN}&from=2026-10-15&to=2026-10-28`);
    expect(october.body.items.every((r: any) => ['2026-10-28', '2026-10-20'].includes(r.submittedAt.slice(0, 10)))).toBe(true);
    expect((await a.get('/api/admin/results?from=not-a-date')).status).toBe(400);
  });

  it('downloads a spreadsheet, without formulas, and records the export', async () => {
    await seed();
    const a = await admin();
    const res = await a.get(`/api/admin/results/export?search=${RUN}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    const text = res.text;
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain('"Teaching quiz","Walking in love"');
    expect(text).toContain('"Passed"');
    // A name that starts with "=" must not turn into a formula in Excel.
    expect(text).toContain(`"'=Evil Paul ${RUN}"`);
    expect(await prisma.auditLog.count({ where: { action: 'EXAM_RESULTS_EXPORTED' } })).toBeGreaterThanOrEqual(1);
  });

  it('is for the central admin only', async () => {
    const anon = agentWithIp();
    expect((await anon.get('/api/admin/results')).status).toBe(401);
  });

  it('lets a member see only their own teaching quizzes', async () => {
    const { marie } = await seed();
    const email = `marie-${RUN}-${n}@example.com`;
    await prisma.memberAccount.create({ data: { personId: marie.id, email, passwordHash: await bcrypt.hash('GoodPass123!', 4) } });
    const agent = agentWithIp();
    const { csrf } = await bootstrap(agent as any);
    await agent.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'GoodPass123!' });
    const mine = await agent.get('/api/member/me/teaching-results');
    expect(mine.status).toBe(200);
    expect(mine.body.items).toHaveLength(1);
    expect(mine.body.items[0]).toMatchObject({ title: 'Walking in love', percentage: 80, passed: true });
  });
});

// A teaching quiz with two questions, taken by two members of an assembly
// (and one person outside it), so the at-a-glance summary has something to say.
async function seedQuiz() {
  const community = await prisma.community.create({ data: { name: `Quiz Assembly ${RUN}${n++}` } });
  const conv = await prisma.conversation.create({ data: { communityId: community.id } });
  const author = await person(`Quiz Teacher ${RUN}`);
  const message = await prisma.message.create({ data: { conversationId: conv.id, senderPersonId: author.id, body: 'Grace' } });
  const assessment = await prisma.assessment.create({
    data: {
      titleEn: 'Teaching quiz: Grace',
      passMark: 50,
      status: 'PUBLISHED',
      questions: {
        create: [
          { textEn: 'Who gives grace?', order: 0, options: { create: [{ textEn: 'God', isCorrect: true, order: 0 }, { textEn: 'Nobody', order: 1 }] } },
          { textEn: 'Is grace earned?', order: 1, options: { create: [{ textEn: 'No', isCorrect: true, order: 0 }, { textEn: 'Yes', order: 1 }] } },
        ],
      },
    },
    include: { questions: { orderBy: { order: 'asc' }, include: { options: { orderBy: { order: 'asc' } } } } },
  });
  await prisma.teaching.create({
    data: { communityId: community.id, messageId: message.id, assessmentId: assessment.id, authorPersonId: author.id, title: 'Grace', text: 'x', closesAt: new Date(Date.now() + 86_400_000) },
  });

  async function take(personId: string, picks: number[]) {
    const wasRight = assessment.questions.map((q, i) => q.options[picks[i]].isCorrect);
    const percentage = (wasRight.filter(Boolean).length / wasRight.length) * 100;
    const a = await prisma.attempt.create({
      data: { personId, assessmentId: assessment.id, attemptNumber: 1, status: 'SUBMITTED', submittedAt: new Date(), score: wasRight.filter(Boolean).length, maxScore: 2, percentage, passMarkAtAttempt: 50, passed: percentage >= 50 },
    });
    await prisma.answer.createMany({
      data: assessment.questions.map((q, i) => ({ attemptId: a.id, questionId: q.id, selectedOptionId: q.options[picks[i]].id, wasCorrect: wasRight[i] })),
    });
  }

  const marie = await person(`Marie Quiz ${RUN}`);
  const ann = await person(`Ann Quiz ${RUN}`);
  const outsider = await person(`Outsider Quiz ${RUN}`);
  for (const p of [marie, ann]) await prisma.communityMembership.create({ data: { personId: p.id, communityId: community.id, status: 'ACTIVE' } });
  await take(marie.id, [0, 0]); // both right
  await take(ann.id, [1, 0]); // first wrong ("Nobody"), second right
  await take(outsider.id, [1, 1]); // both wrong, not in the assembly
  return { community, assessment, marie, ann, outsider };
}

async function leaderAgent(communityId: string) {
  const email = `results-leader-${RUN}-${n++}@test.local`;
  const { user } = await createLeader('Results Leader', email, `RL${RUN}${n}`.slice(0, 20));
  const lp = await person(`Leader Person ${RUN}`);
  await prisma.user.update({ where: { id: user.id }, data: { personId: lp.id } });
  await prisma.roleAssignment.create({ data: { personId: lp.id, roleType: 'SCOPED_LEADER', assignedByUserId: user.id, communityId } });
  await prisma.communityMembership.create({ data: { personId: lp.id, communityId, status: 'ACTIVE' } });
  const agent = agentWithIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'password123' });
  return agent;
}

describe('Quiz at a glance — what people did not understand', () => {
  it('shows the admin who took it, the average, and the hardest question first with the answer key', async () => {
    const { assessment } = await seedQuiz();
    const a = await admin();
    const res = await a.get(`/api/admin/results/quiz/${assessment.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ kind: 'TEACHING', title: 'Grace', taken: 3, passed: 2, averagePercentage: 50, lowestPercentage: 0, highestPercentage: 100 });
    // Q1: right for 1 of 3 (33%), Q2: right for 2 of 3 (67%) — the hardest comes first.
    expect(res.body.questions.map((q: any) => [q.textEn, q.correctPercentage])).toEqual([
      ['Who gives grace?', 33],
      ['Is grace earned?', 67],
    ]);
    expect(res.body.questions[0]).toMatchObject({ correctAnswerEn: 'God', mostChosenWrongEn: { text: 'Nobody', count: 2 } });
    expect((await a.get('/api/admin/results/quiz/does-not-exist')).status).toBe(404);
  });
});

describe('A leader sees the marks of their own members only', () => {
  it('lists, downloads and summarises only the leader’s assembly, without phone numbers or the answer key', async () => {
    const { community, assessment, marie } = await seedQuiz();
    const leader = await leaderAgent(community.id);

    const list = await leader.get('/api/leader/results');
    expect(list.status).toBe(200);
    const names = list.body.items.map((r: any) => r.personName).sort();
    expect(names).toEqual([`Ann Quiz ${RUN}`, `Marie Quiz ${RUN}`]);
    expect(list.body.items.every((r: any) => r.whatsappNumber === '')).toBe(true);
    const byName = await leader.get(`/api/leader/results?search=${encodeURIComponent(`Marie Quiz ${RUN}`)}`);
    expect(byName.body.items.map((r: any) => r.personId)).toEqual([marie.id]);

    const csv = await leader.get('/api/leader/results/export');
    expect(csv.status).toBe(200);
    expect(csv.text).toContain(`Marie Quiz ${RUN}`);
    expect(csv.text).not.toContain(`Outsider Quiz ${RUN}`);
    expect(csv.text).not.toContain('+2376580');

    const summary = await leader.get(`/api/leader/results/quiz/${assessment.id}`);
    expect(summary.status).toBe(200);
    expect(summary.body.taken).toBe(2);
    expect(summary.body.questions.map((q: any) => q.correctPercentage)).toEqual([50, 100]);
    expect(summary.body.questions[0].correctAnswerEn).toBeUndefined();
    expect(summary.body.questions[0].mostChosenWrongEn).toBeUndefined();
  });

  it('shows nothing for a quiz none of the leader’s members took, and a stranger gets nothing', async () => {
    const { assessment } = await seedQuiz();
    const otherAssembly = await prisma.community.create({ data: { name: `Empty Assembly ${RUN}${n++}` } });
    const leader = await leaderAgent(otherAssembly.id);
    expect((await leader.get('/api/leader/results')).body.items).toEqual([]);
    expect((await leader.get(`/api/leader/results/quiz/${assessment.id}`)).status).toBe(404);
    const anon = agentWithIp();
    expect((await anon.get('/api/leader/results')).status).toBe(401);
  });
});
