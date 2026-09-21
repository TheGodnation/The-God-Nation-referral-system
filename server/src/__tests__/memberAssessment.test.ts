import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';

const app = createApp();

// This file drives many Admin logins (to set up devotionals/assessments)
// and many member magic-link request/consume round trips — enough to
// exhaust the shared per-IP loginLimiter/memberLoginRequestLimiter budgets
// if every test shared one source IP (see the Phase 3B attemptScoring.test.ts
// precedent for this exact issue). Each test gets its own simulated IP.
let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.70.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) {
    wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', ip);
  }
  return wrapped;
}

function extractToken(link: string): string {
  return new URL(link).searchParams.get('token')!;
}

async function loginAsAdmin(email: string, password = 'AdminPass123!') {
  await createAdmin(email, password);
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password });
  return { agent, csrf };
}

async function loginAsMember(whatsapp: string, email: string, name = 'Member Person') {
  const person = await prisma.person.create({ data: { name, whatsappNumber: whatsapp } });
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });

  const requestAgent = agentWithUniqueIp();
  const { csrf: requestCsrf } = await bootstrap(requestAgent as any);
  await requestAgent.post('/api/member/auth/request-link').set('X-CSRF-Token', requestCsrf).send({ whatsapp, email });
  const link = spy.mock.calls[0][0].link as string;
  spy.mockRestore();

  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/member/auth/consume').set('X-CSRF-Token', csrf).send({ token: extractToken(link) });
  return { agent, csrf, person };
}

// Builds a published, global-or-community-scoped devotional with a
// published assessment containing 2 questions (1 point each, one correct
// option per question).
async function buildDevotionalAssessment(
  adminAgent: any,
  adminCsrf: string,
  opts: { communityId?: string; passMark?: number; maxAttempts?: number } = {},
) {
  const devotional = await adminAgent
    .post('/api/admin/devotionals')
    .set('X-CSRF-Token', adminCsrf)
    .send({
      titleEn: 'Member Devotional',
      contentEn: 'Body content.',
      communityId: opts.communityId,
      startDate: '2026-10-01',
      endDate: '2026-10-31',
    });
  await adminAgent
    .patch(`/api/admin/devotionals/${devotional.body.id}`)
    .set('X-CSRF-Token', adminCsrf)
    .send({ status: 'PUBLISHED' });

  const assessment = await adminAgent
    .post('/api/admin/assessments')
    .set('X-CSRF-Token', adminCsrf)
    .send({ devotionalId: devotional.body.id, titleEn: 'Member Quiz', passMark: opts.passMark ?? 50, maxAttempts: opts.maxAttempts });

  const questionIds: string[] = [];
  const correctOptionIds: string[] = [];
  const wrongOptionIds: string[] = [];
  for (let i = 0; i < 2; i++) {
    const q = await adminAgent
      .post(`/api/admin/assessments/${assessment.body.id}/questions`)
      .set('X-CSRF-Token', adminCsrf)
      .send({ textEn: `Q${i}` });
    questionIds.push(q.body.id);
    const correct = await adminAgent
      .post(`/api/admin/assessments/questions/${q.body.id}/options`)
      .set('X-CSRF-Token', adminCsrf)
      .send({ textEn: 'Correct', isCorrect: true });
    const wrong = await adminAgent
      .post(`/api/admin/assessments/questions/${q.body.id}/options`)
      .set('X-CSRF-Token', adminCsrf)
      .send({ textEn: 'Wrong', isCorrect: false });
    correctOptionIds.push(correct.body.id);
    wrongOptionIds.push(wrong.body.id);
  }

  await adminAgent.patch(`/api/admin/assessments/${assessment.body.id}`).set('X-CSRF-Token', adminCsrf).send({ status: 'PUBLISHED' });

  return { devotionalId: devotional.body.id, assessmentId: assessment.body.id, questionIds, correctOptionIds, wrongOptionIds };
}

describe('Phase 3C — Member assessment eligibility', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a global (no community) published devotional and its published assessment', async () => {
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-elig-global@test.local');
    const { assessmentId } = await buildDevotionalAssessment(adminAgent, adminCsrf);
    const { agent: memberAgent } = await loginAsMember('+237670010001', 'elig-global@example.com');

    const list = await memberAgent.get('/api/member/devotionals');
    expect(list.status).toBe(200);
    const found = list.body.items.find((d: any) => d.assessments.some((a: any) => a.id === assessmentId));
    expect(found).toBeTruthy();

    const detail = await memberAgent.get(`/api/member/assessments/${assessmentId}`);
    expect(detail.status).toBe(200);
  });

  it('shows a community devotional only to a member with an active membership in that community', async () => {
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-elig-community@test.local');
    const community = await adminAgent.post('/api/admin/communities').set('X-CSRF-Token', adminCsrf).send({ name: 'Eligible Community' });
    const { assessmentId } = await buildDevotionalAssessment(adminAgent, adminCsrf, { communityId: community.body.id });

    const { agent: memberAgent, person: memberPerson } = await loginAsMember('+237670010002', 'elig-community@example.com');

    // Not yet a member of the community — not eligible.
    const before = await memberAgent.get(`/api/member/assessments/${assessmentId}`);
    expect(before.status).toBe(404);

    await adminAgent
      .post(`/api/admin/people/${memberPerson.id}/community-memberships`)
      .set('X-CSRF-Token', adminCsrf)
      .send({ communityId: community.body.id });

    const after = await memberAgent.get(`/api/member/assessments/${assessmentId}`);
    expect(after.status).toBe(200);
  });

  it('never shows a devotional restricted to a DIFFERENT community', async () => {
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-elig-other-community@test.local');
    const communityA = await adminAgent.post('/api/admin/communities').set('X-CSRF-Token', adminCsrf).send({ name: 'Community A' });
    const communityB = await adminAgent.post('/api/admin/communities').set('X-CSRF-Token', adminCsrf).send({ name: 'Community B' });
    const { assessmentId } = await buildDevotionalAssessment(adminAgent, adminCsrf, { communityId: communityB.body.id });

    const { agent: memberAgent, person: memberPerson } = await loginAsMember('+237670010003', 'elig-other@example.com');
    await adminAgent
      .post(`/api/admin/people/${memberPerson.id}/community-memberships`)
      .set('X-CSRF-Token', adminCsrf)
      .send({ communityId: communityA.body.id });

    const res = await memberAgent.get(`/api/member/assessments/${assessmentId}`);
    expect(res.status).toBe(404);
  });

  it('never exposes a DRAFT assessment to a member', async () => {
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-elig-draft@test.local');
    const devotional = await adminAgent
      .post('/api/admin/devotionals')
      .set('X-CSRF-Token', adminCsrf)
      .send({ titleEn: 'Draft Devotional Test', contentEn: 'x', startDate: '2026-10-01', endDate: '2026-10-31' });
    await adminAgent.patch(`/api/admin/devotionals/${devotional.body.id}`).set('X-CSRF-Token', adminCsrf).send({ status: 'PUBLISHED' });
    const assessment = await adminAgent
      .post('/api/admin/assessments')
      .set('X-CSRF-Token', adminCsrf)
      .send({ devotionalId: devotional.body.id, titleEn: 'Still Draft', passMark: 50 });
    // Never published — stays DRAFT.

    const { agent: memberAgent } = await loginAsMember('+237670010004', 'elig-draft@example.com');
    const res = await memberAgent.get(`/api/member/assessments/${assessment.body.id}`);
    expect(res.status).toBe(404);
  });

  it('never exposes an assessment belonging to an ARCHIVED devotional', async () => {
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-elig-archived@test.local');
    const { devotionalId, assessmentId } = await buildDevotionalAssessment(adminAgent, adminCsrf);
    await adminAgent.patch(`/api/admin/devotionals/${devotionalId}`).set('X-CSRF-Token', adminCsrf).send({ status: 'ARCHIVED' });

    const { agent: memberAgent } = await loginAsMember('+237670010005', 'elig-archived@example.com');
    const res = await memberAgent.get(`/api/member/assessments/${assessmentId}`);
    expect(res.status).toBe(404);
  });

  it('requires member authentication for every member-only route', async () => {
    const anon = agentWithUniqueIp();
    const res = await anon.get('/api/member/devotionals');
    expect(res.status).toBe(401);
  });
});

describe('Phase 3C — Member self-service attempt ownership and scoring', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lets a member start, answer, and submit their own attempt, with the server computing the result', async () => {
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-member-attempt@test.local');
    const { assessmentId, questionIds, correctOptionIds } = await buildDevotionalAssessment(adminAgent, adminCsrf, { passMark: 50 });
    const { agent: memberAgent, csrf: memberCsrf } = await loginAsMember('+237670011001', 'attempt1@example.com');

    const start = await memberAgent
      .post(`/api/member/assessments/${assessmentId}/attempts`)
      .set('X-CSRF-Token', memberCsrf);
    expect(start.status).toBe(201);
    expect(start.body.attemptNumber).toBe(1);

    const questions = await memberAgent.get(`/api/member/attempts/${start.body.id}/questions`);
    expect(questions.status).toBe(200);
    expect(JSON.stringify(questions.body)).not.toMatch(/isCorrect/);

    const submit = await memberAgent
      .post(`/api/member/attempts/${start.body.id}/submit`)
      .set('X-CSRF-Token', memberCsrf)
      .send({ answers: questionIds.map((qId: string, i: number) => ({ questionId: qId, selectedOptionId: correctOptionIds[i] })) });
    expect(submit.status).toBe(200);
    expect(submit.body.score).toBe(2);
    expect(submit.body.percentage).toBe(100);
    expect(submit.body.passed).toBe(true);

    const events = await prisma.participationEvent.count({ where: { sourceId: start.body.id } });
    expect(events).toBe(1);
  });

  it('resumes an existing IN_PROGRESS attempt instead of creating a duplicate', async () => {
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-member-resume@test.local');
    const { assessmentId } = await buildDevotionalAssessment(adminAgent, adminCsrf);
    const { agent: memberAgent, csrf: memberCsrf } = await loginAsMember('+237670011002', 'resume@example.com');

    const first = await memberAgent.post(`/api/member/assessments/${assessmentId}/attempts`).set('X-CSRF-Token', memberCsrf);
    const second = await memberAgent.post(`/api/member/assessments/${assessmentId}/attempts`).set('X-CSRF-Token', memberCsrf);

    expect(second.body.id).toBe(first.body.id);
    const attemptCount = await prisma.attempt.count({ where: { assessmentId } });
    expect(attemptCount).toBe(1);
  });

  it('enforces the same maxAttempts limit for member-created attempts as for Admin-created ones', async () => {
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-member-limit@test.local');
    const { assessmentId, questionIds, correctOptionIds } = await buildDevotionalAssessment(adminAgent, adminCsrf, { maxAttempts: 1 });
    const { agent: memberAgent, csrf: memberCsrf } = await loginAsMember('+237670011003', 'limit@example.com');

    const attempt = await memberAgent.post(`/api/member/assessments/${assessmentId}/attempts`).set('X-CSRF-Token', memberCsrf);
    await memberAgent
      .post(`/api/member/attempts/${attempt.body.id}/submit`)
      .set('X-CSRF-Token', memberCsrf)
      .send({ answers: questionIds.map((qId: string, i: number) => ({ questionId: qId, selectedOptionId: correctOptionIds[i] })) });

    const secondAttempt = await memberAgent.post(`/api/member/assessments/${assessmentId}/attempts`).set('X-CSRF-Token', memberCsrf);
    expect(secondAttempt.status).toBe(409);
  });

  it('never lets Member A access, submit, or see Member B\'s attempt/results', async () => {
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-member-ownership@test.local');
    const { assessmentId, questionIds, correctOptionIds } = await buildDevotionalAssessment(adminAgent, adminCsrf);
    const { agent: memberA, csrf: csrfA } = await loginAsMember('+237670011004', 'ownerA@example.com');
    const { agent: memberB, csrf: csrfB } = await loginAsMember('+237670011005', 'ownerB@example.com');

    const attemptA = await memberA.post(`/api/member/assessments/${assessmentId}/attempts`).set('X-CSRF-Token', csrfA);

    // Member B cannot view Member A's attempt or its questions.
    const bViewsA = await memberB.get(`/api/member/attempts/${attemptA.body.id}`);
    expect(bViewsA.status).toBe(404);
    const bViewsAQuestions = await memberB.get(`/api/member/attempts/${attemptA.body.id}/questions`);
    expect(bViewsAQuestions.status).toBe(404);

    // Member B cannot submit Member A's attempt.
    const bSubmitsA = await memberB
      .post(`/api/member/attempts/${attemptA.body.id}/submit`)
      .set('X-CSRF-Token', csrfB)
      .send({ answers: questionIds.map((qId: string, i: number) => ({ questionId: qId, selectedOptionId: correctOptionIds[i] })) });
    expect(bSubmitsA.status).toBe(404);

    // Member A's attempt is untouched (still IN_PROGRESS).
    const stillInProgress = await prisma.attempt.findUnique({ where: { id: attemptA.body.id } });
    expect(stillInProgress!.status).toBe('IN_PROGRESS');

    // Member B's own "my-attempts" for this assessment never includes A's.
    await memberB.post(`/api/member/assessments/${assessmentId}/attempts`).set('X-CSRF-Token', csrfB);
    const bHistory = await memberB.get(`/api/member/assessments/${assessmentId}/my-attempts`);
    expect(bHistory.body.items.every((a: any) => a.id !== attemptA.body.id)).toBe(true);
  });

  it('ignores any client-supplied personId and always uses the authenticated member\'s own Person', async () => {
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-member-personid@test.local');
    const { assessmentId } = await buildDevotionalAssessment(adminAgent, adminCsrf);
    const { agent: memberAgent, csrf: memberCsrf, person } = await loginAsMember('+237670011006', 'personid@example.com');
    const otherPerson = await prisma.person.create({ data: { name: 'Other Person', whatsappNumber: '+237670011007' } });

    const start = await memberAgent
      .post(`/api/member/assessments/${assessmentId}/attempts`)
      .set('X-CSRF-Token', memberCsrf)
      .send({ personId: otherPerson.id });

    expect(start.status).toBe(201);
    const attempt = await prisma.attempt.findUnique({ where: { id: start.body.id } });
    expect(attempt!.personId).toBe(person.id);
    expect(attempt!.personId).not.toBe(otherPerson.id);
  });
});

describe('Phase 3C — Member read-only own Community/Geography', () => {
  it('returns only the member\'s own CommunityMembership, minimal fields, no editing', async () => {
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-member-readonly-community@test.local');
    const community = await adminAgent.post('/api/admin/communities').set('X-CSRF-Token', adminCsrf).send({ name: 'Readonly Community' });
    const { agent: memberAgent, person } = await loginAsMember('+237670012001', 'readonly-community@example.com');

    await adminAgent
      .post(`/api/admin/people/${person.id}/community-memberships`)
      .set('X-CSRF-Token', adminCsrf)
      .send({ communityId: community.body.id });

    const res = await memberAgent.get('/api/member/me/community-memberships');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].communityName).toBe('Readonly Community');
    expect(res.body.items[0].status).toBe('ACTIVE');
    // No route exists to mutate this from the member side — a PATCH attempt
    // against the member router 404s the same as any other unknown path.
    const editAttempt = await memberAgent.patch('/api/member/me/community-memberships');
    expect(editAttempt.status).toBe(404);
  });

  it('returns only the member\'s own GeographicAssignment, or null if unassigned', async () => {
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-member-readonly-geo@test.local');
    const { agent: memberAgentUnassigned } = await loginAsMember('+237670012002', 'readonly-geo-none@example.com');

    const none = await memberAgentUnassigned.get('/api/member/me/geographic-assignment');
    expect(none.body.assignment).toBeNull();

    const country = await adminAgent
      .post('/api/admin/geography')
      .set('X-CSRF-Token', adminCsrf)
      .send({ name: 'Readonly Land', type: 'COUNTRY', countryCode: 'RL' });
    const { agent: memberAgentAssigned, person } = await loginAsMember('+237670012003', 'readonly-geo-yes@example.com');
    await adminAgent
      .put(`/api/admin/people/${person.id}/geographic-assignment`)
      .set('X-CSRF-Token', adminCsrf)
      .send({ geographyId: country.body.id });

    const assigned = await memberAgentAssigned.get('/api/member/me/geographic-assignment');
    expect(assigned.body.assignment.geographyName).toBe('Readonly Land');
    expect(assigned.body.assignment.geographyType).toBe('COUNTRY');
  });

  it('never exposes another member\'s community/geography data', async () => {
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-member-readonly-isolation@test.local');
    const community = await adminAgent.post('/api/admin/communities').set('X-CSRF-Token', adminCsrf).send({ name: 'Isolated Community' });
    const { person: personA } = await loginAsMember('+237670012004', 'isolation-a@example.com');
    const { agent: memberB } = await loginAsMember('+237670012005', 'isolation-b@example.com');

    await adminAgent
      .post(`/api/admin/people/${personA.id}/community-memberships`)
      .set('X-CSRF-Token', adminCsrf)
      .send({ communityId: community.body.id });

    const bView = await memberB.get('/api/member/me/community-memberships');
    expect(bView.body.items).toHaveLength(0);
  });
});
