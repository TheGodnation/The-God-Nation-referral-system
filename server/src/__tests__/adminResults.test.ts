import { describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createAdmin } from './helpers';
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
