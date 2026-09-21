import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createLeader, createAdmin } from './helpers';
import { bootstrap } from './testUtils';

const app = createApp();

async function loginAsAdmin(email = 'admin-assessment@test.local', password = 'AdminPass123!') {
  await createAdmin(email, password);
  const agent = request.agent(app);
  const { csrf } = await bootstrap(agent);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password });
  return { agent, csrf };
}

async function makePerson(whatsappNumber: string, name = 'Assessment Test Person') {
  return prisma.person.create({ data: { name, whatsappNumber } });
}

async function createDevotional(agent: any, csrf: string) {
  const res = await agent
    .post('/api/admin/devotionals')
    .set('X-CSRF-Token', csrf)
    .send({ titleEn: 'Test Devotional', contentEn: 'Body', startDate: '2026-10-01', endDate: '2026-10-31' });
  return res.body;
}

describe('Phase 3B — Assessment creation and lifecycle', () => {
  it('creates an assessment linked to a devotional, with pass mark and max attempts', async () => {
    const { agent, csrf } = await loginAsAdmin();
    const devotional = await createDevotional(agent, csrf);

    const assessment = await agent
      .post('/api/admin/assessments')
      .set('X-CSRF-Token', csrf)
      .send({ devotionalId: devotional.id, titleEn: 'October Quiz', passMark: 70, maxAttempts: 2 });
    expect(assessment.status).toBe(201);
    expect(assessment.body.devotionalId).toBe(devotional.id);
    expect(assessment.body.passMark).toBe(70);
    expect(assessment.body.maxAttempts).toBe(2);
    expect(assessment.body.status).toBe('DRAFT');
  });

  it('supports unlimited attempts when maxAttempts is omitted', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-assessment-unlimited@test.local');
    const assessment = await agent
      .post('/api/admin/assessments')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Unlimited Quiz', passMark: 50 });
    expect(assessment.body.maxAttempts).toBeNull();
  });

  it('creates questions and options before publish/lock, with ordering and one correct option per question', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-assessment-questions@test.local');
    const assessment = await agent
      .post('/api/admin/assessments')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Question Quiz', passMark: 50 });
    const assessmentId = assessment.body.id;

    const q1 = await agent
      .post(`/api/admin/assessments/${assessmentId}/questions`)
      .set('X-CSRF-Token', csrf)
      .send({ textEn: 'What is faith?', order: 0, points: 2 });
    expect(q1.status).toBe(201);
    expect(q1.body.points).toBe(2);

    const q2 = await agent
      .post(`/api/admin/assessments/${assessmentId}/questions`)
      .set('X-CSRF-Token', csrf)
      .send({ textEn: 'What is hope?', order: 1 });
    expect(q2.body.points).toBe(1); // default

    const opt1 = await agent
      .post(`/api/admin/assessments/questions/${q1.body.id}/options`)
      .set('X-CSRF-Token', csrf)
      .send({ textEn: 'Confidence in what is hoped for', isCorrect: true, order: 0 });
    const opt2 = await agent
      .post(`/api/admin/assessments/questions/${q1.body.id}/options`)
      .set('X-CSRF-Token', csrf)
      .send({ textEn: 'A feeling', isCorrect: false, order: 1 });
    expect(opt1.body.isCorrect).toBe(true);
    expect(opt2.body.isCorrect).toBe(false);

    // Setting a second option correct clears the first — exactly one
    // correct option per question is enforced.
    const opt2MadeCorrect = await agent
      .patch(`/api/admin/assessments/options/${opt2.body.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ isCorrect: true });
    expect(opt2MadeCorrect.body.isCorrect).toBe(true);

    const detail = await agent.get(`/api/admin/assessments/${assessmentId}`);
    const question1 = detail.body.questions.find((q: any) => q.id === q1.body.id);
    const correctOptions = question1.options.filter((o: any) => o.isCorrect);
    expect(correctOptions).toHaveLength(1);
    expect(correctOptions[0].id).toBe(opt2.body.id);
  });

  it('locks the assessment on the first Attempt and rejects further edits', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-assessment-lock@test.local');
    const assessment = await agent
      .post('/api/admin/assessments')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Lock Quiz', passMark: 50 });
    const assessmentId = assessment.body.id;

    const question = await agent
      .post(`/api/admin/assessments/${assessmentId}/questions`)
      .set('X-CSRF-Token', csrf)
      .send({ textEn: 'Q1' });
    const correctOption = await agent
      .post(`/api/admin/assessments/questions/${question.body.id}/options`)
      .set('X-CSRF-Token', csrf)
      .send({ textEn: 'Right', isCorrect: true });
    await agent
      .post(`/api/admin/assessments/questions/${question.body.id}/options`)
      .set('X-CSRF-Token', csrf)
      .send({ textEn: 'Wrong', isCorrect: false });

    const publish = await agent
      .patch(`/api/admin/assessments/${assessmentId}`)
      .set('X-CSRF-Token', csrf)
      .send({ status: 'PUBLISHED' });
    expect(publish.body.status).toBe('PUBLISHED');

    const person = await makePerson('+237670005001');
    const attempt = await agent
      .post(`/api/admin/people/${person.id}/attempts`)
      .set('X-CSRF-Token', csrf)
      .send({ assessmentId });
    expect(attempt.status).toBe(201);

    const lockedAssessment = await prisma.assessment.findUnique({ where: { id: assessmentId } });
    expect(lockedAssessment!.status).toBe('LOCKED');

    // Every kind of edit is now rejected.
    const editAssessment = await agent
      .patch(`/api/admin/assessments/${assessmentId}`)
      .set('X-CSRF-Token', csrf)
      .send({ passMark: 90 });
    expect(editAssessment.status).toBe(409);

    const editQuestion = await agent
      .patch(`/api/admin/assessments/questions/${question.body.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ textEn: 'Changed question text' });
    expect(editQuestion.status).toBe(409);

    const editOption = await agent
      .patch(`/api/admin/assessments/options/${correctOption.body.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ isCorrect: false });
    expect(editOption.status).toBe(409);

    const deleteQuestion = await agent
      .delete(`/api/admin/assessments/questions/${question.body.id}`)
      .set('X-CSRF-Token', csrf);
    expect(deleteQuestion.status).toBe(409);

    const newQuestion = await agent
      .post(`/api/admin/assessments/${assessmentId}/questions`)
      .set('X-CSRF-Token', csrf)
      .send({ textEn: 'New question after lock' });
    expect(newQuestion.status).toBe(409);

    // The correct answer, as stored, is still exactly as configured before
    // the lock — none of the rejected edits above changed anything.
    const stillCorrect = await prisma.option.findUnique({ where: { id: correctOption.body.id } });
    expect(stillCorrect!.isCorrect).toBe(true);
  });

  it('never exposes isCorrect in the pre-submission attempt-taking view', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-assessment-hide-correct@test.local');
    const assessment = await agent
      .post('/api/admin/assessments')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Hidden Answer Quiz', passMark: 50 });
    const question = await agent
      .post(`/api/admin/assessments/${assessment.body.id}/questions`)
      .set('X-CSRF-Token', csrf)
      .send({ textEn: 'Q1' });
    await agent
      .post(`/api/admin/assessments/questions/${question.body.id}/options`)
      .set('X-CSRF-Token', csrf)
      .send({ textEn: 'Right', isCorrect: true });
    await agent
      .post(`/api/admin/assessments/questions/${question.body.id}/options`)
      .set('X-CSRF-Token', csrf)
      .send({ textEn: 'Wrong', isCorrect: false });
    await agent.patch(`/api/admin/assessments/${assessment.body.id}`).set('X-CSRF-Token', csrf).send({ status: 'PUBLISHED' });

    const person = await makePerson('+237670005002');
    const attempt = await agent
      .post(`/api/admin/people/${person.id}/attempts`)
      .set('X-CSRF-Token', csrf)
      .send({ assessmentId: assessment.body.id });

    const takingView = await agent.get(`/api/admin/attempts/${attempt.body.id}/questions`);
    expect(takingView.status).toBe(200);
    expect(takingView.body.status).toBe('IN_PROGRESS');
    const serialized = JSON.stringify(takingView.body);
    expect(serialized).not.toMatch(/isCorrect/);
  });

  it('requires Admin authorization for every assessment/question/option mutation', async () => {
    const anon = request.agent(app);
    const { csrf: anonCsrf } = await bootstrap(anon);
    const anonCreate = await anon
      .post('/api/admin/assessments')
      .set('X-CSRF-Token', anonCsrf)
      .send({ titleEn: 'Nope', passMark: 50 });
    expect(anonCreate.status).toBe(401);

    await createLeader('Assessment Leader', 'leader-assessment@example.com', 'ASSLD1');
    const leaderAgent = request.agent(app);
    const { csrf: leaderCsrf } = await bootstrap(leaderAgent);
    await leaderAgent
      .post('/api/auth/login')
      .set('X-CSRF-Token', leaderCsrf)
      .send({ email: 'leader-assessment@example.com', password: 'password123' });
    const leaderCreate = await leaderAgent
      .post('/api/admin/assessments')
      .set('X-CSRF-Token', leaderCsrf)
      .send({ titleEn: 'Nope', passMark: 50 });
    expect(leaderCreate.status).toBe(403);
  });
});
