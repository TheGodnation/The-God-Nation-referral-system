import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { addYears, nextHalving, rateAt, rateSchedule, yearsElapsed, awardClinicTokens } from '../lib/tokens';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';

// King's Token (Phase 5a): earned by correct answers in a Dominion Clinic exam
// (1 each since 22 Nov 2026: one correct answer, one token), only from the start day the central
// admin sets, first try only; the foundation is credited 30 for every 70 earned;
// the start day can no longer move once it has arrived.
const app = createApp();
const DAY = 24 * 60 * 60 * 1000;

let ip = 0;
function agentWithUniqueIp() {
  ip += 1;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', `10.158.0.${ip}`);
  return wrapped;
}
let n = 0;
async function member(name: string) {
  n += 1;
  const email = `tok${n}@example.com`;
  const person = await prisma.person.create({ data: { name, whatsappNumber: `+2376680${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() } });
  await prisma.memberAccount.create({ data: { personId: person.id, email } });
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/member/auth/request-code').set('X-CSRF-Token', csrf).send({ email });
  const code = spy.mock.calls[0][0].code as string;
  spy.mockRestore();
  await agent.post('/api/member/auth/verify-code').set('X-CSRF-Token', csrf).send({ email, code });
  return { agent, csrf, person };
}
async function adminLogin() {
  await createAdmin('tok-admin@test.local', 'AdminPass123!');
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: 'tok-admin@test.local', password: 'AdminPass123!' });
  return { agent, csrf };
}
async function clinicExam(questions = 10) {
  const devotional = await prisma.monthlyDevotional.create({
    data: { titleEn: 'November', titleFr: 'Novembre', contentEn: '-', status: 'PUBLISHED', startDate: new Date(Date.now() - 1 * DAY), endDate: new Date(Date.now() + 20 * DAY) },
  });
  const exam = await prisma.assessment.create({ data: { titleEn: 'Exam 1', passMark: 50, status: 'PUBLISHED', devotionalId: devotional.id, weekNumber: 1 } });
  const correct = new Map<string, string>();
  const wrong = new Map<string, string>();
  for (let i = 0; i < questions; i++) {
    const q = await prisma.question.create({
      data: { assessmentId: exam.id, textEn: `Q${i}`, order: i, options: { create: [{ textEn: 'Right', isCorrect: true, order: 0 }, { textEn: 'Wrong', isCorrect: false, order: 1 }] } },
      include: { options: true },
    });
    correct.set(q.id, q.options.find((o) => o.isCorrect)!.id);
    wrong.set(q.id, q.options.find((o) => !o.isCorrect)!.id);
  }
  return { exam, correct, wrong };
}
/** Takes the exam: answers the first `right` questions correctly, the rest wrongly. */
async function take(m: Awaited<ReturnType<typeof member>>, e: Awaited<ReturnType<typeof clinicExam>>, right: number) {
  const attempt = (await m.agent.post(`/api/member/assessments/${e.exam.id}/attempts`).set('X-CSRF-Token', m.csrf).send({})).body;
  const asked: { id: string }[] = (await m.agent.get(`/api/member/attempts/${attempt.id}/questions`)).body.questions;
  const answers = asked.map((q, i) => ({ questionId: q.id, selectedOptionId: (i < right ? e.correct : e.wrong).get(q.id)! }));
  const res = await m.agent.post(`/api/member/attempts/${attempt.id}/submit`).set('X-CSRF-Token', m.csrf).send({ answers });
  return { attempt, res };
}
const startNow = (days = 0) => prisma.settings.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', tokensStartAt: new Date(Date.now() - days * DAY) }, update: { tokensStartAt: new Date(Date.now() - days * DAY) } });

describe('the rate schedule', () => {
  const start = new Date('2027-01-15T00:00:00Z');
  it('pays 1 per correct answer in the Dominion Clinic for ever, and the books start at 16, halving every 4 years to 2', () => {
    const at = (years: number, extraDays = 1) => new Date(addYears(start, years).getTime() + extraDays * DAY);
    expect([0, 3, 4, 7, 8, 11, 12, 13, 40].map((y) => rateAt('CLINIC', start, at(y)))).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect([0, 4, 8, 12, 30].map((y) => rateAt('BOOK', start, at(y)))).toEqual([16, 8, 4, 2, 2]);
    // The books' last day of year 4 is still the old rate; the first day of year 5 is the new one.
    expect(rateAt('BOOK', start, new Date(addYears(start, 4).getTime() - 1))).toBe(16);
    expect(rateAt('BOOK', start, addYears(start, 4))).toBe(8);
  });
  it('has no rate before the start day or when it has not been set', () => {
    expect(rateAt('CLINIC', start, new Date(start.getTime() - 1))).toBeNull();
    expect(rateAt('CLINIC', null, new Date())).toBeNull();
    expect(yearsElapsed(start, new Date(start.getTime() - 1))).toBeNull();
  });
  it('says when the reward next halves: never for the Dominion Clinic (already at 1), and for the books until they reach 2', () => {
    expect(nextHalving('CLINIC', start, new Date(start.getTime() + DAY))).toBeNull();
    expect(nextHalving('BOOK', start, new Date(start.getTime() + DAY))).toEqual({ at: addYears(start, 4).toISOString(), rate: 8 });
    expect(nextHalving('BOOK', start, addYears(start, 9))).toEqual({ at: addYears(start, 12).toISOString(), rate: 2 });
    expect(nextHalving('BOOK', start, addYears(start, 13))).toBeNull();
  });
  it('publishes the schedule: the Dominion Clinic stays at 1, the books go 16, 8, 4, then 2 for ever', () => {
    expect(rateSchedule()).toEqual([
      { fromYear: 1, toYear: 4, clinic: 1, book: 16 },
      { fromYear: 5, toYear: 8, clinic: 1, book: 8 },
      { fromYear: 9, toYear: 12, clinic: 1, book: 4 },
      { fromYear: 13, toYear: null, clinic: 1, book: 2 },
    ]);
  });
  it('moves 29 February to 28 February in a year that has none', () => {
    expect(addYears(new Date('2028-02-29T00:00:00Z'), 1).toISOString()).toBe('2029-02-28T00:00:00.000Z');
  });
});

describe('earning in a Dominion Clinic exam', () => {
  it('earns nothing until the start day has been set', async () => {
    const e = await clinicExam();
    const m = await member('Student Sam');
    await take(m, e, 10);
    expect(await prisma.tokenEntry.count()).toBe(0);
  });

  it('earns 1 token per correct answer, and credits the foundation 30 for every 70', async () => {
    await startNow();
    const e = await clinicExam();
    const m = await member('Student Sam');
    const { res } = await take(m, e, 7);
    expect(res.status).toBe(200);
    expect(res.body.tokensEarned).toBe(7);

    const entry = await prisma.tokenEntry.findFirstOrThrow({ where: { personId: m.person.id } });
    expect(entry).toMatchObject({ kind: 'EARNED', reason: 'CLINIC_EXAM', correctAnswers: 7 });
    expect(entry.amount.toNumber()).toBe(7);
    expect(entry.ratePerAnswer!.toNumber()).toBe(1);
    const share = await prisma.tokenEntry.findFirstOrThrow({ where: { personId: null } });
    expect(share).toMatchObject({ reason: 'FOUNDATION_SHARE', sourceEntryId: entry.id });
    expect(share.amount.toNumber()).toBe(3); // 7 x 30 / 70
    // Locked for 4 years.
    expect(share.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 4 * 365 * DAY - 2 * DAY);

    const view = (await m.agent.get('/api/member/tokens')).body;
    expect(view).toMatchObject({ started: true, usable: false, clinicRate: 1, balance: { earned: 7, bought: 0, total: 7 }, foundation: { total: 3 } });
    expect(view.history).toHaveLength(1);
    expect(view.history[0]).toMatchObject({ reason: 'CLINIC_EXAM', amount: 7, correctAnswers: 7, examNumber: 1, monthTitleEn: 'November' });
    expect(view.nextHalving).toBeNull(); // already at the one rate it stays at
  });

  it('earns nothing for a try with no correct answer', async () => {
    await startNow();
    const e = await clinicExam();
    const m = await member('Student Sam');
    await take(m, e, 0);
    expect(await prisma.tokenEntry.count()).toBe(0);
  });

  it('counts the first try only: a second try never earns, even with a better score', async () => {
    await startNow();
    const e = await clinicExam();
    const m = await member('Student Sam');
    await take(m, e, 3);
    await take(m, e, 10).catch(() => {});
    const entries = await prisma.tokenEntry.findMany({ where: { personId: m.person.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0].amount.toNumber()).toBe(3);
    // Asking again to credit the same try does nothing.
    const first = await prisma.attempt.findFirstOrThrow({ where: { personId: m.person.id }, orderBy: { attemptNumber: 'asc' } });
    expect((await awardClinicTokens(first.id)).awarded).toBe(false);
    expect(await prisma.tokenEntry.count({ where: { reason: 'FOUNDATION_SHARE' } })).toBe(1);
  });

  it('does not count an exam taken before the start day', async () => {
    const e = await clinicExam();
    const m = await member('Student Sam');
    await take(m, e, 10);
    // The start day is set to tomorrow, then tokens start: the earlier try stays uncredited.
    await prisma.settings.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', tokensStartAt: new Date(Date.now() + DAY) }, update: { tokensStartAt: new Date(Date.now() + DAY) } });
    expect(await prisma.tokenEntry.count()).toBe(0);
    const view = (await m.agent.get('/api/member/tokens')).body;
    expect(view).toMatchObject({ started: false, balance: { total: 0 }, clinicRate: null });
    // Even once the start day arrives, an exam taken before it is not credited by the safety net.
    const taken = await prisma.attempt.findFirstOrThrow({ where: { personId: m.person.id } });
    await prisma.settings.update({ where: { id: 'singleton' }, data: { tokensStartAt: new Date(taken.submittedAt!.getTime() + 1) } });
    expect(((await m.agent.get('/api/member/tokens')).body as any).balance.total).toBe(0);
  });

  it('only a Dominion Clinic exam earns: an exam with no week number does not', async () => {
    await startNow();
    const e = await clinicExam();
    await prisma.assessment.update({ where: { id: e.exam.id }, data: { weekNumber: null } });
    const m = await member('Student Sam');
    await take(m, e, 10).catch(() => {});
    expect(await prisma.tokenEntry.count()).toBe(0);
  });

  it('shows each exam\'s tokens in the member\'s Dominion Clinic results', async () => {
    await startNow();
    const e = await clinicExam();
    const m = await member('Student Sam');
    await take(m, e, 5);
    const results = (await m.agent.get('/api/member/clinic')).body;
    expect(results.exams[0]).toMatchObject({ score: 5, tokens: 5 });
  });

  it('a member sees only their own tokens', async () => {
    await startNow();
    const e = await clinicExam();
    const a = await member('Student Sam');
    const b = await member('Student Lea');
    await take(a, e, 10);
    expect(((await b.agent.get('/api/member/tokens')).body as any).balance.total).toBe(0);
    expect(((await a.agent.get('/api/member/tokens')).body as any).balance.total).toBe(10);
    // The foundation's balance is shown to every member.
    expect(((await b.agent.get('/api/member/tokens')).body as any).foundation.total).toBeCloseTo(10 * 30 / 70, 5);
  });
});

describe('the ranking by total tokens', () => {
  it('lists members from the most tokens to the fewest, with the same rank for the same total, and marks the viewer', async () => {
    await startNow();
    const e = await clinicExam();
    const a = await member('Student Sam');
    const b = await member('Student Lea');
    const c = await member('Student Joe');
    const d = await member('Student Zed');
    await take(a, e, 4);
    await take(b, e, 9);
    await take(c, e, 9);
    // d takes nothing: not in the list.
    const res = await a.agent.get('/api/member/tokens/ranking');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);
    expect(res.body.items.map((r: any) => [r.rank, r.name, r.total])).toEqual([
      [1, expect.stringMatching(/Student (Lea|Joe)/), 9],
      [1, expect.stringMatching(/Student (Lea|Joe)/), 9],
      [3, 'Student Sam', 4],
    ]);
    expect(res.body.items.filter((r: any) => r.isMe)).toHaveLength(1);
    expect(res.body.me).toMatchObject({ rank: 3, name: 'Student Sam', total: 4, isMe: true });
    // Only a name and a total are shown: nothing else about anyone.
    expect(Object.keys(res.body.items[0]).sort()).toEqual(['isMe', 'name', 'rank', 'total']);
    // A member with no tokens yet is not ranked, but sees the list.
    const mine = await d.agent.get('/api/member/tokens/ranking');
    expect(mine.body.me).toBeNull();
    expect(mine.body.items).toHaveLength(3);
  });

  it('counts what was earned, not what is left: giving tokens never lowers a rank, and the foundation share is not counted', async () => {
    await startNow();
    const e = await clinicExam();
    const a = await member('Student Sam');
    await take(a, e, 6);
    await prisma.tokenEntry.create({ data: { personId: a.person.id, kind: 'BURNED', reason: 'SPEND_BURN', amount: -2 } });
    const res = await a.agent.get('/api/member/tokens/ranking');
    expect(res.body.items).toEqual([{ rank: 1, name: 'Student Sam', total: 6, isMe: true }]);
  });

  it('needs a signed-in member', async () => {
    expect((await request(app).get('/api/member/tokens/ranking')).status).toBe(401);
  });
});

describe('the central admin starts the count', () => {
  it('starts now, shows the totals, and cannot move the day once it has arrived', async () => {
    const admin = await adminLogin();
    const before = (await admin.agent.get('/api/admin/tokens/summary')).body;
    expect(before).toMatchObject({ started: false, startsAt: null, earnedTotal: 0, foundationTotal: 0 });
    expect(before.schedule).toHaveLength(4);

    const started = await admin.agent.put('/api/admin/tokens/start').set('X-CSRF-Token', admin.csrf).send({ now: true });
    expect(started.status).toBe(200);
    expect(started.body).toMatchObject({ started: true, clinicRate: 1 });
    expect(await prisma.auditLog.count({ where: { action: 'TOKENS_START_SET' } })).toBe(1);

    const again = await admin.agent.put('/api/admin/tokens/start').set('X-CSRF-Token', admin.csrf).send({ now: true });
    expect(again.status).toBe(409);
    const date = await admin.agent.put('/api/admin/tokens/start').set('X-CSRF-Token', admin.csrf).send({ date: '2099-01-01' });
    expect(date.status).toBe(409);

    const e = await clinicExam();
    const m = await member('Student Sam');
    await take(m, e, 10);
    const after = (await admin.agent.get('/api/admin/tokens/summary')).body;
    expect(after).toMatchObject({ earnedTotal: 10, members: 1 });
    expect(after.foundationTotal).toBeCloseTo(10 * 30 / 70, 5);
  });

  it('can choose a future day and change it until it arrives, but not a day in the past', async () => {
    const admin = await adminLogin();
    const put = (body: object) => admin.agent.put('/api/admin/tokens/start').set('X-CSRF-Token', admin.csrf).send(body);
    const tomorrow = new Date(Date.now() + 14 * DAY).toISOString().slice(0, 10);
    const later = new Date(Date.now() + 20 * DAY).toISOString().slice(0, 10);
    const first = await put({ date: tomorrow });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ started: false, startsAt: `${tomorrow}T00:00:00.000Z` });
    expect((await put({ date: later })).body.startsAt).toBe(`${later}T00:00:00.000Z`);
    expect((await put({ date: '2020-01-01' })).status).toBe(400);
    expect((await put({ date: 'soon' })).status).toBe(400);
  });

  it('is for the central admin only, and the central admin\'s own member profile has the same button', async () => {
    const m = await member('Student Sam');
    expect((await m.agent.get('/api/member/central-tokens/summary')).status).toBe(403);
    expect((await m.agent.put('/api/member/central-tokens/start').set('X-CSRF-Token', m.csrf).send({ now: true })).status).toBe(403);
    expect(await prisma.settings.count({ where: { tokensStartAt: { not: null } } })).toBe(0);

    const owner = await member('Owner Person');
    const admin = await createAdmin('tok-owner@test.local', 'AdminPass123!');
    await prisma.user.update({ where: { id: admin.id }, data: { personId: owner.person.id } });
    const res = await owner.agent.put('/api/member/central-tokens/start').set('X-CSRF-Token', owner.csrf).send({ now: true });
    expect(res.status).toBe(200);
    expect(res.body.started).toBe(true);
  });
});

// A teaching taught from a portion of the month's book has a quiz that earns the same as a monthly exam, one portion at a time.
describe('earning in the quiz of a teaching taught from the book', () => {
  async function teachingQuiz(withPortion: boolean, questions = 10) {
    const exam = await prisma.assessment.create({ data: { titleEn: 'Teaching quiz: Faith', passMark: 50, maxAttempts: 1, status: 'PUBLISHED' } });
    const correct = new Map<string, string>();
    const wrong = new Map<string, string>();
    for (let i = 0; i < questions; i++) {
      const q = await prisma.question.create({
        data: { assessmentId: exam.id, textEn: `Q${i}`, order: i, options: { create: [{ textEn: 'Right', isCorrect: true, order: 0 }, { textEn: 'Wrong', isCorrect: false, order: 1 }] } },
        include: { options: true },
      });
      correct.set(q.id, q.options.find((o) => o.isCorrect)!.id);
      wrong.set(q.id, q.options.find((o) => !o.isCorrect)!.id);
    }
    const author = await prisma.person.create({ data: { name: 'Teacher T', whatsappNumber: `+23766899${String(++n).padStart(4, '0')}`, profileCompletedAt: new Date() } });
    const group = await prisma.community.create({ data: { name: `Teaching group ${n}` } });
    const conversation = await prisma.conversation.create({ data: { communityId: group.id } });
    const message = await prisma.message.create({ data: { conversationId: conversation.id, senderPersonId: author.id, body: 'Faith' } });
    const book = withPortion ? await prisma.libraryBook.create({ data: { kind: 'TRAINING', titleEn: 'Kingdom Keys' } as any }) : null;
    const teaching = await prisma.teaching.create({
      data: { communityId: group.id, messageId: message.id, assessmentId: exam.id, authorPersonId: author.id, title: 'Faith', closesAt: new Date(Date.now() + 7 * DAY), portionBookId: book?.id ?? null, portionPage: book ? 14 : null },
    });
    return { exam, correct, wrong, teaching };
  }
  // The member is in the group and has been seen to finish the teaching, so its quiz is open to them.
  const ready = async (m: Awaited<ReturnType<typeof member>>, teaching: { id: string; communityId: string }) => {
    await prisma.communityMembership.upsert({ where: { personId_communityId: { personId: m.person.id, communityId: teaching.communityId } }, create: { communityId: teaching.communityId, personId: m.person.id, status: 'ACTIVE' } as any, update: {} });
    await prisma.teachingProgress.create({ data: { teachingId: teaching.id, personId: m.person.id, completedAt: new Date() } });
  };

  it('earns 1 per correct answer and credits the foundation, like a monthly exam, once the start day is set', async () => {
    await startNow();
    const t = await teachingQuiz(true);
    const m = await member('Student Sam');
    await ready(m, t.teaching);
    const { res } = await take(m, t as any, 9);
    expect(res.status).toBe(200);
    expect(res.body.tokensEarned).toBe(9);
    const entry = await prisma.tokenEntry.findFirstOrThrow({ where: { personId: m.person.id } });
    expect(entry).toMatchObject({ kind: 'EARNED', reason: 'CLINIC_EXAM', correctAnswers: 9 });
    expect(entry.ratePerAnswer!.toNumber()).toBe(1);
    expect((await prisma.tokenEntry.findFirstOrThrow({ where: { personId: null } })).amount.toNumber()).toBeCloseTo(3.857143, 5); // 9 x 30 / 70
    expect((await m.agent.get('/api/member/tokens')).body.balance.earned).toBe(9);
  });

  it('earns nothing before the start day is set, for a teaching with no book portion, or for a second try', async () => {
    const early = await teachingQuiz(true);
    const m = await member('Student Sam');
    await ready(m, early.teaching);
    await take(m, early as any, 10);
    expect(await prisma.tokenEntry.count()).toBe(0); // the start day has not been set
    await startNow();
    const plain = await teachingQuiz(false);
    await ready(m, plain.teaching);
    await take(m, plain as any, 10);
    expect(await prisma.tokenEntry.count()).toBe(0); // no portion of the book: an ordinary teaching quiz
    const again = await teachingQuiz(true);
    await ready(m, again.teaching);
    await take(m, again as any, 3);
    await take(m, again as any, 10).catch(() => {});
    const entries = await prisma.tokenEntry.findMany({ where: { personId: m.person.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0].amount.toNumber()).toBe(3); // first try only
  });
});
