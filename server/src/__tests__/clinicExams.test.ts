import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { processClinicExamReminders, clinicResultsFor } from '../lib/clinicExams';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';

// Dominion Clinic exams: an exam every N days (exam 1 with the month's book),
// N questions drawn from the book's questions and scored on those only, members
// told once when an exam opens, and every exam's first-try score with a total.
const app = createApp();
const DAY = 24 * 60 * 60 * 1000;

let ip = 0;
function agentWithUniqueIp() {
  ip += 1;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', `10.157.0.${ip}`);
  return wrapped;
}
let n = 0;
async function member(name: string, communityId?: string) {
  n += 1;
  const email = `ce${n}@example.com`;
  const person = await prisma.person.create({ data: { name, whatsappNumber: `+2376670${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() } });
  await prisma.memberAccount.create({ data: { personId: person.id, email } });
  if (communityId) await prisma.communityMembership.create({ data: { personId: person.id, communityId, status: 'ACTIVE' } });
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/member/auth/request-code').set('X-CSRF-Token', csrf).send({ email });
  const code = spy.mock.calls[0][0].code as string;
  spy.mockRestore();
  await agent.post('/api/member/auth/verify-code').set('X-CSRF-Token', csrf).send({ email, code });
  return { agent, csrf, person };
}

async function month(startedDaysAgo: number, examNumbers: number[], questionsPerExam = 15) {
  const devotional = await prisma.monthlyDevotional.create({
    data: { titleEn: 'November', titleFr: 'Novembre', contentEn: '-', status: 'PUBLISHED', startDate: new Date(Date.now() - startedDaysAgo * DAY), endDate: new Date(Date.now() + 20 * DAY) },
  });
  const exams: { id: string; number: number; questionIds: string[]; correct: Map<string, string> }[] = [];
  for (const number of examNumbers) {
    const exam = await prisma.assessment.create({ data: { titleEn: `Exam ${number}`, passMark: 50, status: 'PUBLISHED', devotionalId: devotional.id, weekNumber: number } });
    const questionIds: string[] = [];
    const correct = new Map<string, string>();
    for (let i = 0; i < questionsPerExam; i++) {
      const q = await prisma.question.create({
        data: { assessmentId: exam.id, textEn: `Q${i}`, order: i, options: { create: [{ textEn: 'Right', isCorrect: true, order: 0 }, { textEn: 'Wrong', isCorrect: false, order: 1 }] } },
        include: { options: true },
      });
      questionIds.push(q.id);
      correct.set(q.id, q.options.find((o) => o.isCorrect)!.id);
    }
    exams.push({ id: exam.id, number, questionIds, correct });
  }
  return { devotional, exams };
}

describe('exams open on the rhythm', () => {
  it('exam 1 opens with the book, then one every N days; an exam that has not opened cannot be started', async () => {
    const { exams } = await month(12, [1, 2, 3]); // 12 days in: exams 1 (day 0) and 2 (day 10) are open, 3 (day 20) is not
    const m = await member('Student Sam');
    const start = (id: string) => m.agent.post(`/api/member/assessments/${id}/attempts`).set('X-CSRF-Token', m.csrf).send({});
    expect((await start(exams[0].id)).status).toBe(201);
    expect((await start(exams[1].id)).status).toBe(201);
    const closed = await start(exams[2].id);
    expect(closed.status).toBe(409);

    // The central admin slows the rhythm to one exam every 20 days: exam 2 is not open yet.
    await prisma.settings.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', clinicExamEveryDays: 20 }, update: { clinicExamEveryDays: 20 } });
    const later = await member('Student Lea');
    expect((await later.agent.post(`/api/member/assessments/${exams[1].id}/attempts`).set('X-CSRF-Token', later.csrf).send({})).status).toBe(409);
    expect((await later.agent.post(`/api/member/assessments/${exams[0].id}/attempts`).set('X-CSRF-Token', later.csrf).send({})).status).toBe(201);
  });

  it('the member list says when each exam opens and whether it is open', async () => {
    const { exams } = await month(12, [1, 3]);
    const m = await member('Student Sam');
    const world = (await m.agent.get('/api/member/exam-world')).body;
    const list = world.devotionals[0].exams;
    expect(list.find((e: any) => e.weekNumber === 1)).toMatchObject({ open: true });
    expect(list.find((e: any) => e.weekNumber === 3)).toMatchObject({ open: false });
    expect(new Date(list.find((e: any) => e.weekNumber === 3).opensAt).getTime()).toBeGreaterThan(Date.now());
    void exams;
  });
});

describe('an exam draws its questions from the book', () => {
  it('asks only the number set (default 10) of the 15 questions in the bank, and scores those only', async () => {
    const { exams } = await month(1, [1], 15);
    const exam = exams[0];
    const m = await member('Student Sam');
    const attempt = (await m.agent.post(`/api/member/assessments/${exam.id}/attempts`).set('X-CSRF-Token', m.csrf).send({})).body;
    const asked = (await m.agent.get(`/api/member/attempts/${attempt.id}/questions`)).body.questions;
    expect(asked).toHaveLength(10);
    expect(new Set(asked.map((q: any) => q.id)).size).toBe(10);
    expect(asked.every((q: any) => exam.questionIds.includes(q.id))).toBe(true);

    // Answer the 10 drawn questions correctly: 10 of 10.
    const answers = asked.map((q: any) => ({ questionId: q.id, selectedOptionId: exam.correct.get(q.id)! }));
    const done = await m.agent.post(`/api/member/attempts/${attempt.id}/submit`).set('X-CSRF-Token', m.csrf).send({ answers });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ score: 10, maxScore: 10, percentage: 100, passed: true });

    // A question that was not drawn is refused.
    const other = exams[0].questionIds.find((id) => !asked.some((q: any) => q.id === id))!;
    const second = await member('Student Lea');
    const a2 = (await second.agent.post(`/api/member/assessments/${exam.id}/attempts`).set('X-CSRF-Token', second.csrf).send({})).body;
    const drawn2 = (await second.agent.get(`/api/member/attempts/${a2.id}/questions`)).body.questions.map((q: any) => q.id);
    const notDrawn = exam.questionIds.find((id) => !drawn2.includes(id))!;
    const bad = await second.agent.post(`/api/member/attempts/${a2.id}/submit`).set('X-CSRF-Token', second.csrf).send({ answers: [{ questionId: notDrawn, selectedOptionId: exam.correct.get(notDrawn)! }] });
    expect(bad.status).toBe(400);
    void other;
  });

  it('follows the central admin\'s number of questions, and asks them all when the bank is no bigger', async () => {
    await prisma.settings.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', clinicExamQuestions: 5 }, update: { clinicExamQuestions: 5 } });
    const { exams } = await month(1, [1], 15);
    const m = await member('Student Sam');
    const a = (await m.agent.post(`/api/member/assessments/${exams[0].id}/attempts`).set('X-CSRF-Token', m.csrf).send({})).body;
    expect((await m.agent.get(`/api/member/attempts/${a.id}/questions`)).body.questions).toHaveLength(5);

    await prisma.settings.update({ where: { id: 'singleton' }, data: { clinicExamQuestions: 20 } });
    const b = await member('Student Lea');
    const a2 = (await b.agent.post(`/api/member/assessments/${exams[0].id}/attempts`).set('X-CSRF-Token', b.csrf).send({})).body;
    expect((await b.agent.get(`/api/member/attempts/${a2.id}/questions`)).body.questions).toHaveLength(15);
  });
});

describe('telling members an exam has opened', () => {
  it('announces each exam once, when it opens, to everyone who can take it', async () => {
    const hq = await prisma.community.create({ data: { name: 'Assembly' } });
    const { exams } = await month(11, [1, 2, 3], 3); // exams 1 and 2 are open, 3 is not
    const a = await member('Reader A', hq.id);
    const b = await member('Reader B', hq.id);

    expect(await processClinicExamReminders()).toBe(2);
    expect(await prisma.notification.count({ where: { recipientPersonId: a.person.id, type: 'CLINIC_EXAM_OPEN' } })).toBe(2);
    expect(await prisma.notification.count({ where: { recipientPersonId: b.person.id, type: 'CLINIC_EXAM_OPEN' } })).toBe(2);
    expect(await processClinicExamReminders()).toBe(0);
    // Exam 3 is announced on its day.
    expect(await processClinicExamReminders(new Date(Date.now() + 10 * DAY))).toBe(1);
    void exams;
  });
});

describe('my Dominion Clinic results', () => {
  it('lists each exam with the first-try score and a total; later tries are only practice', async () => {
    const { exams } = await month(12, [1, 2], 4);
    const m = await member('Student Sam');
    const take = async (examId: string, correctCount: number) => {
      const attempt = (await m.agent.post(`/api/member/assessments/${examId}/attempts`).set('X-CSRF-Token', m.csrf).send({})).body;
      const asked = (await m.agent.get(`/api/member/attempts/${attempt.id}/questions`)).body.questions;
      const exam = exams.find((e) => e.id === examId)!;
      const answers = asked.map((q: any, i: number) => ({ questionId: q.id, selectedOptionId: i < correctCount ? exam.correct.get(q.id)! : [...(q.options as any[])].find((o) => o.id !== exam.correct.get(q.id)).id }));
      await m.agent.post(`/api/member/attempts/${attempt.id}/submit`).set('X-CSRF-Token', m.csrf).send({ answers });
    };
    await take(exams[0].id, 3); // 3 of 4
    await take(exams[0].id, 4); // practice: does not count
    await take(exams[1].id, 2); // 2 of 4

    const r = (await m.agent.get('/api/member/clinic')).body;
    expect(r.rhythm).toMatchObject({ examEveryDays: 10, examQuestions: 10, topicRhythm: 'DAILY' });
    const byNumber = (k: number) => r.exams.find((e: any) => e.number === k);
    expect(byNumber(1)).toMatchObject({ score: 3, maxScore: 4, percentage: 75, open: true });
    expect(byNumber(2)).toMatchObject({ score: 2, maxScore: 4 });
    expect(r.total).toEqual({ exams: 2, score: 5, maxScore: 8 });
    // Only my own results.
    const other = await member('Someone else');
    expect((await other.agent.get('/api/member/clinic')).body.total).toEqual({ exams: 0, score: 0, maxScore: 0 });
    void clinicResultsFor;
  });
});

describe('the rhythm settings', () => {
  it('the central admin changes the topic rhythm, the days between exams and the questions per exam; nonsense is refused', async () => {
    await createAdmin('rhythm-admin@test.local', 'AdminPass123!');
    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: 'rhythm-admin@test.local', password: 'AdminPass123!' });
    expect((await agent.get('/api/admin/cells/clinic/settings')).body).toEqual({ examEveryDays: 10, examQuestions: 10, topicRhythm: 'DAILY' });
    const ok = await agent.put('/api/admin/cells/clinic/settings').set('X-CSRF-Token', csrf).send({ topicRhythm: 'MORNING_EVENING', examEveryDays: 7, examQuestions: 12 });
    expect(ok.status).toBe(200);
    expect((await agent.get('/api/admin/cells/clinic/settings')).body).toEqual({ examEveryDays: 7, examQuestions: 12, topicRhythm: 'MORNING_EVENING' });
    for (const bad of [{ topicRhythm: 'HOURLY', examEveryDays: 7, examQuestions: 10 }, { topicRhythm: 'DAILY', examEveryDays: 0, examQuestions: 10 }, { topicRhythm: 'DAILY', examEveryDays: 7, examQuestions: 99 }]) {
      expect((await agent.put('/api/admin/cells/clinic/settings').set('X-CSRF-Token', csrf).send(bad)).status).toBe(400);
    }
  });
});
