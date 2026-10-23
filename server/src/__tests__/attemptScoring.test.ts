import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';

const app = createApp();

// This file logs in as a fresh Admin and drives many attempt-start/submit
// calls per test, across many tests — enough to exhaust the shared
// per-IP loginLimiter/adminSensitiveLimiter budgets if every test used the
// same source IP. Giving each test its own simulated IP (via
// X-Forwarded-For, honored because app.ts sets `trust proxy: 1`) keeps
// every test's rate-limit bucket independent, matching real distinct
// visitors rather than one IP hammering the server.
let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.60.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) {
    wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', ip);
  }
  return wrapped;
}

async function loginAsAdmin(email: string, password = 'AdminPass123!') {
  await createAdmin(email, password);
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password });
  return { agent, csrf };
}

async function makePerson(whatsappNumber: string, name = 'Scoring Test Person') {
  return prisma.person.create({ data: { name, whatsappNumber } });
}

// Builds a published assessment with `questions` questions, each with a
// correct and an incorrect option, optionally with custom point values.
async function buildPublishedAssessment(
  agent: any,
  csrf: string,
  opts: { passMark: number; maxAttempts?: number; points?: number[] },
) {
  const assessment = await agent
    .post('/api/admin/assessments')
    .set('X-CSRF-Token', csrf)
    .send({ titleEn: 'Scoring Quiz', passMark: opts.passMark, maxAttempts: opts.maxAttempts });
  const assessmentId = assessment.body.id;

  const points = opts.points ?? [1, 1];
  const questionIds: string[] = [];
  const correctOptionIds: string[] = [];
  const wrongOptionIds: string[] = [];

  for (let i = 0; i < points.length; i++) {
    const q = await agent
      .post(`/api/admin/assessments/${assessmentId}/questions`)
      .set('X-CSRF-Token', csrf)
      .send({ textEn: `Question ${i}`, points: points[i] });
    questionIds.push(q.body.id);
    const correct = await agent
      .post(`/api/admin/assessments/questions/${q.body.id}/options`)
      .set('X-CSRF-Token', csrf)
      .send({ textEn: 'Correct', isCorrect: true });
    const wrong = await agent
      .post(`/api/admin/assessments/questions/${q.body.id}/options`)
      .set('X-CSRF-Token', csrf)
      .send({ textEn: 'Wrong', isCorrect: false });
    correctOptionIds.push(correct.body.id);
    wrongOptionIds.push(wrong.body.id);
  }

  await agent.patch(`/api/admin/assessments/${assessmentId}`).set('X-CSRF-Token', csrf).send({ status: 'PUBLISHED' });

  return { assessmentId, questionIds, correctOptionIds, wrongOptionIds };
}

describe('Phase 3B — Server-side scoring', () => {
  it('scores 0% when every answer is wrong', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-score-zero@test.local');
    const { assessmentId, questionIds, wrongOptionIds } = await buildPublishedAssessment(agent, csrf, { passMark: 50 });
    const person = await makePerson('+237670006001');

    const attempt = await agent.post(`/api/admin/people/${person.id}/attempts`).set('X-CSRF-Token', csrf).send({ assessmentId });
    const submit = await agent
      .post(`/api/admin/attempts/${attempt.body.id}/submit`)
      .set('X-CSRF-Token', csrf)
      .send({ answers: questionIds.map((qId, i) => ({ questionId: qId, selectedOptionId: wrongOptionIds[i] })) });

    expect(submit.status).toBe(200);
    expect(submit.body.score).toBe(0);
    expect(submit.body.maxScore).toBe(2);
    expect(submit.body.percentage).toBe(0);
    expect(submit.body.passed).toBe(false);
  });

  it('scores 100% when every answer is correct', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-score-full@test.local');
    const { assessmentId, questionIds, correctOptionIds } = await buildPublishedAssessment(agent, csrf, { passMark: 50 });
    const person = await makePerson('+237670006002');

    const attempt = await agent.post(`/api/admin/people/${person.id}/attempts`).set('X-CSRF-Token', csrf).send({ assessmentId });
    const submit = await agent
      .post(`/api/admin/attempts/${attempt.body.id}/submit`)
      .set('X-CSRF-Token', csrf)
      .send({ answers: questionIds.map((qId, i) => ({ questionId: qId, selectedOptionId: correctOptionIds[i] })) });

    expect(submit.body.score).toBe(2);
    expect(submit.body.percentage).toBe(100);
    expect(submit.body.passed).toBe(true);
  });

  it('scores a partial result, and treats a percentage exactly equal to the pass mark as passing', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-score-partial@test.local');
    const { assessmentId, questionIds, correctOptionIds, wrongOptionIds } = await buildPublishedAssessment(agent, csrf, {
      passMark: 50,
    });
    const person = await makePerson('+237670006003');

    const attempt = await agent.post(`/api/admin/people/${person.id}/attempts`).set('X-CSRF-Token', csrf).send({ assessmentId });
    const submit = await agent
      .post(`/api/admin/attempts/${attempt.body.id}/submit`)
      .set('X-CSRF-Token', csrf)
      .send({
        answers: [
          { questionId: questionIds[0], selectedOptionId: correctOptionIds[0] },
          { questionId: questionIds[1], selectedOptionId: wrongOptionIds[1] },
        ],
      });

    expect(submit.body.score).toBe(1);
    expect(submit.body.percentage).toBe(50);
    expect(submit.body.passMarkAtAttempt).toBe(50);
    expect(submit.body.passed).toBe(true); // exactly at pass mark -> passes
  });

  it('fails a percentage just below the pass mark', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-score-below@test.local');
    // 3 questions, 1 point each -> 33% or 66% possible, pass mark 50 means
    // 1/3 (33%) fails, cleanly below the mark.
    const { assessmentId, questionIds, correctOptionIds, wrongOptionIds } = await buildPublishedAssessment(agent, csrf, {
      passMark: 50,
      points: [1, 1, 1],
    });
    const person = await makePerson('+237670006004');

    const attempt = await agent.post(`/api/admin/people/${person.id}/attempts`).set('X-CSRF-Token', csrf).send({ assessmentId });
    const submit = await agent
      .post(`/api/admin/attempts/${attempt.body.id}/submit`)
      .set('X-CSRF-Token', csrf)
      .send({
        answers: [
          { questionId: questionIds[0], selectedOptionId: correctOptionIds[0] },
          { questionId: questionIds[1], selectedOptionId: wrongOptionIds[1] },
          { questionId: questionIds[2], selectedOptionId: wrongOptionIds[2] },
        ],
      });

    expect(submit.body.passed).toBe(false);
    expect(submit.body.percentage).toBeCloseTo(33.33, 1);
  });

  it('weights questions by their point values', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-score-points@test.local');
    const { assessmentId, questionIds, correctOptionIds, wrongOptionIds } = await buildPublishedAssessment(agent, csrf, {
      passMark: 50,
      points: [1, 3],
    });
    const person = await makePerson('+237670006005');

    const attempt = await agent.post(`/api/admin/people/${person.id}/attempts`).set('X-CSRF-Token', csrf).send({ assessmentId });
    const submit = await agent
      .post(`/api/admin/attempts/${attempt.body.id}/submit`)
      .set('X-CSRF-Token', csrf)
      .send({
        answers: [
          { questionId: questionIds[0], selectedOptionId: wrongOptionIds[0] },
          { questionId: questionIds[1], selectedOptionId: correctOptionIds[1] },
        ],
      });

    expect(submit.body.score).toBe(3);
    expect(submit.body.maxScore).toBe(4);
    expect(submit.body.percentage).toBe(75);
  });

  it('never trusts a client-supplied score, percentage, or passed value', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-score-untrusted@test.local');
    const { assessmentId, questionIds, wrongOptionIds } = await buildPublishedAssessment(agent, csrf, { passMark: 50 });
    const person = await makePerson('+237670006006');

    const attempt = await agent.post(`/api/admin/people/${person.id}/attempts`).set('X-CSRF-Token', csrf).send({ assessmentId });
    const submit = await agent
      .post(`/api/admin/attempts/${attempt.body.id}/submit`)
      .set('X-CSRF-Token', csrf)
      .send({
        answers: questionIds.map((qId, i) => ({ questionId: qId, selectedOptionId: wrongOptionIds[i] })),
        // These must be completely ignored by the server.
        score: 999,
        percentage: 100,
        passed: true,
        maxScore: 1,
      });

    expect(submit.body.score).toBe(0);
    expect(submit.body.percentage).toBe(0);
    expect(submit.body.passed).toBe(false);
  });
});

describe('Phase 3B — Attempts, limits, and historical integrity', () => {
  it('numbers attempts sequentially and enforces maxAttempts', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-attempts-limit@test.local');
    const { assessmentId, questionIds, correctOptionIds } = await buildPublishedAssessment(agent, csrf, {
      passMark: 50,
      maxAttempts: 2,
    });
    const person = await makePerson('+237670007001');

    const attempt1 = await agent.post(`/api/admin/people/${person.id}/attempts`).set('X-CSRF-Token', csrf).send({ assessmentId });
    expect(attempt1.status).toBe(201);
    expect(attempt1.body.attemptNumber).toBe(1);
    await agent
      .post(`/api/admin/attempts/${attempt1.body.id}/submit`)
      .set('X-CSRF-Token', csrf)
      .send({ answers: questionIds.map((qId, i) => ({ questionId: qId, selectedOptionId: correctOptionIds[i] })) });

    const attempt2 = await agent.post(`/api/admin/people/${person.id}/attempts`).set('X-CSRF-Token', csrf).send({ assessmentId });
    expect(attempt2.status).toBe(201);
    expect(attempt2.body.attemptNumber).toBe(2);
    await agent
      .post(`/api/admin/attempts/${attempt2.body.id}/submit`)
      .set('X-CSRF-Token', csrf)
      .send({ answers: questionIds.map((qId, i) => ({ questionId: qId, selectedOptionId: correctOptionIds[i] })) });

    // maxAttempts = 2 already used.
    const attempt3 = await agent.post(`/api/admin/people/${person.id}/attempts`).set('X-CSRF-Token', csrf).send({ assessmentId });
    expect(attempt3.status).toBe(409);
  });

  it('allows exactly one attempt when maxAttempts = 1', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-attempts-one@test.local');
    const { assessmentId } = await buildPublishedAssessment(agent, csrf, { passMark: 50, maxAttempts: 1 });
    const person = await makePerson('+237670007002');

    const first = await agent.post(`/api/admin/people/${person.id}/attempts`).set('X-CSRF-Token', csrf).send({ assessmentId });
    expect(first.status).toBe(201);
    const second = await agent.post(`/api/admin/people/${person.id}/attempts`).set('X-CSRF-Token', csrf).send({ assessmentId });
    expect(second.status).toBe(409);
  });

  it('allows unlimited attempts when maxAttempts is null', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-attempts-unlimited@test.local');
    const { assessmentId, questionIds, correctOptionIds } = await buildPublishedAssessment(agent, csrf, { passMark: 50 });
    const person = await makePerson('+237670007003');

    for (let i = 1; i <= 4; i++) {
      const attempt = await agent.post(`/api/admin/people/${person.id}/attempts`).set('X-CSRF-Token', csrf).send({ assessmentId });
      expect(attempt.status).toBe(201);
      expect(attempt.body.attemptNumber).toBe(i);
      await agent
        .post(`/api/admin/attempts/${attempt.body.id}/submit`)
        .set('X-CSRF-Token', csrf)
        .send({ answers: questionIds.map((qId, j) => ({ questionId: qId, selectedOptionId: correctOptionIds[j] })) });
    }
  });

  it('rejects a duplicate attemptNumber at the database level (defense in depth)', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-attempts-dup@test.local');
    const { assessmentId } = await buildPublishedAssessment(agent, csrf, { passMark: 50 });
    const person = await makePerson('+237670007004');

    await agent.post(`/api/admin/people/${person.id}/attempts`).set('X-CSRF-Token', csrf).send({ assessmentId });

    // Simulate a duplicate attemptNumber the way a race condition would
    // produce one, and confirm the unique constraint rejects it.
    await expect(
      prisma.attempt.create({ data: { personId: person.id, assessmentId, attemptNumber: 1 } }),
    ).rejects.toThrow();
  });

  it('starts concurrent attempt-creation requests safely — exactly one succeeds per attemptNumber slot', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-attempts-concurrent@test.local');
    const { assessmentId } = await buildPublishedAssessment(agent, csrf, { passMark: 50, maxAttempts: 1 });
    const person = await makePerson('+237670007005');

    const [a, b] = await Promise.all([
      agent.post(`/api/admin/people/${person.id}/attempts`).set('X-CSRF-Token', csrf).send({ assessmentId }),
      agent.post(`/api/admin/people/${person.id}/attempts`).set('X-CSRF-Token', csrf).send({ assessmentId }),
    ]);
    const statuses = [a.status, b.status].sort();
    // Exactly one of the two concurrent requests succeeds (201); the other
    // is cleanly rejected (409 — either the maxAttempts=1 limit or the
    // unique-constraint race handler), never a 500.
    expect(statuses[0]).toBe(201);
    expect(statuses[1]).toBe(409);

    const attemptCount = await prisma.attempt.count({ where: { personId: person.id, assessmentId } });
    expect(attemptCount).toBe(1);
  });

  it('rejects resubmission of an already-submitted attempt, and never records a second ParticipationEvent', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-attempts-resubmit@test.local');
    const { assessmentId, questionIds, correctOptionIds } = await buildPublishedAssessment(agent, csrf, { passMark: 50 });
    const person = await makePerson('+237670007006');

    const attempt = await agent.post(`/api/admin/people/${person.id}/attempts`).set('X-CSRF-Token', csrf).send({ assessmentId });
    const firstSubmit = await agent
      .post(`/api/admin/attempts/${attempt.body.id}/submit`)
      .set('X-CSRF-Token', csrf)
      .send({ answers: questionIds.map((qId, i) => ({ questionId: qId, selectedOptionId: correctOptionIds[i] })) });
    expect(firstSubmit.status).toBe(200);

    const retrySubmit = await agent
      .post(`/api/admin/attempts/${attempt.body.id}/submit`)
      .set('X-CSRF-Token', csrf)
      .send({ answers: questionIds.map((qId, i) => ({ questionId: qId, selectedOptionId: correctOptionIds[i] })) });
    expect(retrySubmit.status).toBe(409);

    const events = await prisma.participationEvent.findMany({
      where: { personId: person.id, type: 'ASSESSMENT_COMPLETED', sourceType: 'ATTEMPT', sourceId: attempt.body.id },
    });
    expect(events).toHaveLength(1);
  });

  it('creates exactly one ParticipationEvent per successful submission, with the correct Person/source/timestamp', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-participation@test.local');
    const { assessmentId, questionIds, correctOptionIds } = await buildPublishedAssessment(agent, csrf, { passMark: 50 });
    const person = await makePerson('+237670007007');

    const before = new Date();
    const attempt = await agent.post(`/api/admin/people/${person.id}/attempts`).set('X-CSRF-Token', csrf).send({ assessmentId });
    await agent
      .post(`/api/admin/attempts/${attempt.body.id}/submit`)
      .set('X-CSRF-Token', csrf)
      .send({ answers: questionIds.map((qId, i) => ({ questionId: qId, selectedOptionId: correctOptionIds[i] })) });

    const events = await prisma.participationEvent.findMany({ where: { personId: person.id } });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('ASSESSMENT_COMPLETED');
    expect(events[0].sourceType).toBe('ATTEMPT');
    expect(events[0].sourceId).toBe(attempt.body.id);
    expect(events[0].occurredAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it('rejects a submitted question ID that does not belong to the assessment, and an option that does not belong to its question', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-attempts-invalid@test.local');
    const { assessmentId, questionIds } = await buildPublishedAssessment(agent, csrf, { passMark: 50 });
    const other = await buildPublishedAssessment(agent, csrf, { passMark: 50 });
    const person = await makePerson('+237670007008');

    const attempt = await agent.post(`/api/admin/people/${person.id}/attempts`).set('X-CSRF-Token', csrf).send({ assessmentId });

    const foreignQuestion = await agent
      .post(`/api/admin/attempts/${attempt.body.id}/submit`)
      .set('X-CSRF-Token', csrf)
      .send({ answers: [{ questionId: other.questionIds[0], selectedOptionId: other.correctOptionIds[0] }] });
    expect(foreignQuestion.status).toBe(400);

    const mismatchedOption = await agent
      .post(`/api/admin/attempts/${attempt.body.id}/submit`)
      .set('X-CSRF-Token', csrf)
      .send({ answers: [{ questionId: questionIds[0], selectedOptionId: other.correctOptionIds[0] }] });
    expect(mismatchedOption.status).toBe(400);
  });

  it('rejects a duplicate answer for the same question in one submission', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-attempts-dup-answer@test.local');
    const { assessmentId, questionIds, correctOptionIds, wrongOptionIds } = await buildPublishedAssessment(agent, csrf, {
      passMark: 50,
    });
    const person = await makePerson('+237670007009');
    const attempt = await agent.post(`/api/admin/people/${person.id}/attempts`).set('X-CSRF-Token', csrf).send({ assessmentId });

    const res = await agent
      .post(`/api/admin/attempts/${attempt.body.id}/submit`)
      .set('X-CSRF-Token', csrf)
      .send({
        answers: [
          { questionId: questionIds[0], selectedOptionId: correctOptionIds[0] },
          { questionId: questionIds[0], selectedOptionId: wrongOptionIds[0] },
        ],
      });
    expect(res.status).toBe(400);
  });

  it('handles a missing answer for a question by scoring it zero, without erroring', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-attempts-partial-answers@test.local');
    const { assessmentId, questionIds, correctOptionIds } = await buildPublishedAssessment(agent, csrf, { passMark: 50 });
    const person = await makePerson('+237670007010');
    const attempt = await agent.post(`/api/admin/people/${person.id}/attempts`).set('X-CSRF-Token', csrf).send({ assessmentId });

    const submit = await agent
      .post(`/api/admin/attempts/${attempt.body.id}/submit`)
      .set('X-CSRF-Token', csrf)
      .send({ answers: [{ questionId: questionIds[0], selectedOptionId: correctOptionIds[0] }] });

    expect(submit.status).toBe(200);
    expect(submit.body.score).toBe(1);
    expect(submit.body.maxScore).toBe(2);
  });

  it('keeps historical Attempt results unchanged after the Assessment is locked', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-attempts-historical@test.local');
    const { assessmentId, questionIds, correctOptionIds } = await buildPublishedAssessment(agent, csrf, { passMark: 50 });
    const person = await makePerson('+237670007011');

    const attempt = await agent.post(`/api/admin/people/${person.id}/attempts`).set('X-CSRF-Token', csrf).send({ assessmentId });
    const submit = await agent
      .post(`/api/admin/attempts/${attempt.body.id}/submit`)
      .set('X-CSRF-Token', csrf)
      .send({ answers: questionIds.map((qId, i) => ({ questionId: qId, selectedOptionId: correctOptionIds[i] })) });
    expect(submit.body.passed).toBe(true);
    expect(submit.body.passMarkAtAttempt).toBe(50);

    // Assessment is now LOCKED (asserted in the dedicated locking test) —
    // the historical Attempt row must remain exactly as computed at
    // submission time regardless of anything that happens to the
    // Assessment afterward.
    const reread = await prisma.attempt.findUnique({ where: { id: attempt.body.id } });
    expect(reread!.passMarkAtAttempt).toBe(50);
    expect(reread!.passed).toBe(true);
    expect(reread!.score).toBe(2);
  });
});
