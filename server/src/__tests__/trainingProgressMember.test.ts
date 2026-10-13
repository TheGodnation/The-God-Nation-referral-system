import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';

const app = createApp();

let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.80.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
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

async function makeDevotionalWithAssessment(
  adminAgent: any,
  adminCsrf: string,
  opts: { communityId?: string; passMark?: number; titleEn?: string } = {},
) {
  const devotional = await adminAgent
    .post('/api/admin/devotionals')
    .set('X-CSRF-Token', adminCsrf)
    .send({
      titleEn: opts.titleEn ?? 'Progress Devotional',
      contentEn: 'Body content.',
      communityId: opts.communityId,
      startDate: '2026-10-01',
      endDate: '2026-10-31',
    });
  await adminAgent.patch(`/api/admin/devotionals/${devotional.body.id}`).set('X-CSRF-Token', adminCsrf).send({ status: 'PUBLISHED' });

  const assessment = await adminAgent
    .post('/api/admin/assessments')
    .set('X-CSRF-Token', adminCsrf)
    .send({ devotionalId: devotional.body.id, titleEn: 'Progress Quiz', passMark: opts.passMark ?? 50 });
  await adminAgent.patch(`/api/admin/assessments/${assessment.body.id}`).set('X-CSRF-Token', adminCsrf).send({ status: 'PUBLISHED' });

  return { devotionalId: devotional.body.id, assessmentId: assessment.body.id };
}

/** Directly seeds an Attempt row via Prisma — bypasses the full
 * question/option/answer submission flow, since the training-progress
 * helper only reads Attempt.status/passed/percentage/submittedAt. */
async function seedAttempt(
  personId: string,
  assessmentId: string,
  attemptNumber: number,
  opts: { status?: 'IN_PROGRESS' | 'SUBMITTED'; passed?: boolean | null; percentage?: number | null; submittedAt?: Date | null },
) {
  return prisma.attempt.create({
    data: {
      personId,
      assessmentId,
      attemptNumber,
      status: opts.status ?? 'SUBMITTED',
      passed: opts.passed ?? null,
      percentage: opts.percentage ?? null,
      maxScore: 2,
      score: opts.passed ? 2 : 0,
      passMarkAtAttempt: 50,
      submittedAt: opts.status === 'IN_PROGRESS' ? null : (opts.submittedAt ?? new Date()),
    },
  });
}

describe('Phase 3E — GET /api/member/me/training-progress', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects an unauthenticated request', async () => {
    const anon = agentWithUniqueIp();
    const res = await anon.get('/api/member/me/training-progress');
    expect(res.status).toBe(401);
  });

  it('a global published devotional is eligible for any member', async () => {
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-tp1@test.local');
    const { devotionalId } = await makeDevotionalWithAssessment(adminAgent, adminCsrf);
    const { agent: memberAgent } = await loginAsMember('+237680000001', 'tp1@example.com');

    const res = await memberAgent.get('/api/member/me/training-progress');
    expect(res.status).toBe(200);
    expect(res.body.totalEligible).toBe(1);
    expect(res.body.items[0].devotionalId).toBe(devotionalId);
    expect(res.body.items[0].attempted).toBe(false);
    expect(res.body.items[0].completed).toBe(false);
  });

  it('a community devotional is eligible only via an ACTIVE membership in that exact community', async () => {
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-tp2@test.local');
    const community = await adminAgent.post('/api/admin/communities').set('X-CSRF-Token', adminCsrf).send({ name: 'TP Community' });
    await makeDevotionalWithAssessment(adminAgent, adminCsrf, { communityId: community.body.id });
    const { agent: memberAgent, person } = await loginAsMember('+237680000002', 'tp2@example.com');

    const before = await memberAgent.get('/api/member/me/training-progress');
    expect(before.body.totalEligible).toBe(0);

    await adminAgent
      .post(`/api/admin/people/${person.id}/community-memberships`)
      .set('X-CSRF-Token', adminCsrf)
      .send({ communityId: community.body.id });

    const after = await memberAgent.get('/api/member/me/training-progress');
    expect(after.body.totalEligible).toBe(1);
  });

  it('excludes a devotional whose community membership is INACTIVE', async () => {
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-tp3@test.local');
    const community = await adminAgent.post('/api/admin/communities').set('X-CSRF-Token', adminCsrf).send({ name: 'TP Inactive Community' });
    await makeDevotionalWithAssessment(adminAgent, adminCsrf, { communityId: community.body.id });
    const { agent: memberAgent, person } = await loginAsMember('+237680000003', 'tp3@example.com');

    const membership = await adminAgent
      .post(`/api/admin/people/${person.id}/community-memberships`)
      .set('X-CSRF-Token', adminCsrf)
      .send({ communityId: community.body.id });
    await adminAgent
      .patch(`/api/admin/community-memberships/${membership.body.id}`)
      .set('X-CSRF-Token', adminCsrf)
      .send({ status: 'INACTIVE' });

    const res = await memberAgent.get('/api/member/me/training-progress');
    expect(res.body.totalEligible).toBe(0);
  });

  it('a failed-only attempt does not mark the devotional completed', async () => {
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-tp4@test.local');
    const { assessmentId } = await makeDevotionalWithAssessment(adminAgent, adminCsrf);
    const { agent: memberAgent, person } = await loginAsMember('+237680000004', 'tp4@example.com');

    await seedAttempt(person.id, assessmentId, 1, { passed: false, percentage: 0 });

    const res = await memberAgent.get('/api/member/me/training-progress');
    expect(res.body.items[0].attempted).toBe(true);
    expect(res.body.items[0].completed).toBe(false);
    expect(res.body.completedCount).toBe(0);
  });

  it('passing any one of multiple assessments completes the devotional', async () => {
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-tp5@test.local');
    const devotional = await adminAgent
      .post('/api/admin/devotionals')
      .set('X-CSRF-Token', adminCsrf)
      .send({ titleEn: 'Multi Assessment Devotional', contentEn: 'x', startDate: '2026-10-01', endDate: '2026-10-31' });
    await adminAgent.patch(`/api/admin/devotionals/${devotional.body.id}`).set('X-CSRF-Token', adminCsrf).send({ status: 'PUBLISHED' });

    const assessmentA = await adminAgent
      .post('/api/admin/assessments')
      .set('X-CSRF-Token', adminCsrf)
      .send({ devotionalId: devotional.body.id, titleEn: 'Quiz A', passMark: 50 });
    await adminAgent.patch(`/api/admin/assessments/${assessmentA.body.id}`).set('X-CSRF-Token', adminCsrf).send({ status: 'PUBLISHED' });

    const assessmentB = await adminAgent
      .post('/api/admin/assessments')
      .set('X-CSRF-Token', adminCsrf)
      .send({ devotionalId: devotional.body.id, titleEn: 'Quiz B', passMark: 50 });
    await adminAgent.patch(`/api/admin/assessments/${assessmentB.body.id}`).set('X-CSRF-Token', adminCsrf).send({ status: 'PUBLISHED' });

    const { agent: memberAgent, person } = await loginAsMember('+237680000005', 'tp5@example.com');

    // Failed A, passed B — the devotional as a whole is still completed.
    await seedAttempt(person.id, assessmentA.body.id, 1, { passed: false, percentage: 20 });
    await seedAttempt(person.id, assessmentB.body.id, 1, { passed: true, percentage: 80 });

    const res = await memberAgent.get('/api/member/me/training-progress');
    expect(res.body.totalEligible).toBe(1);
    expect(res.body.items[0].completed).toBe(true);
    expect(res.body.items[0].assessmentIds.sort()).toEqual([assessmentA.body.id, assessmentB.body.id].sort());
    // Best percentage aggregates across BOTH assessments of the devotional.
    expect(res.body.items[0].bestPercentage).toBe(80);
  });

  it('best percentage is the maximum across relevant SUBMITTED attempts', async () => {
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-tp6@test.local');
    const { assessmentId } = await makeDevotionalWithAssessment(adminAgent, adminCsrf);
    const { agent: memberAgent, person } = await loginAsMember('+237680000006', 'tp6@example.com');

    await seedAttempt(person.id, assessmentId, 1, { passed: false, percentage: 40 });
    await seedAttempt(person.id, assessmentId, 2, { passed: true, percentage: 90 });
    await seedAttempt(person.id, assessmentId, 3, { passed: true, percentage: 70 });

    const res = await memberAgent.get('/api/member/me/training-progress');
    expect(res.body.items[0].bestPercentage).toBe(90);
  });

  it('excludes an IN_PROGRESS attempt from best percentage — never treats it as zero', async () => {
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-tp7@test.local');
    const { assessmentId } = await makeDevotionalWithAssessment(adminAgent, adminCsrf);
    const { agent: memberAgent, person } = await loginAsMember('+237680000007', 'tp7@example.com');

    await seedAttempt(person.id, assessmentId, 1, { passed: true, percentage: 60 });
    await seedAttempt(person.id, assessmentId, 2, { status: 'IN_PROGRESS' });

    const res = await memberAgent.get('/api/member/me/training-progress');
    expect(res.body.items[0].bestPercentage).toBe(60);
    expect(res.body.items[0].attempted).toBe(true);
  });

  it('last attempt is the latest SUBMITTED attempt date, ignoring IN_PROGRESS attempts', async () => {
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-tp8@test.local');
    const { assessmentId } = await makeDevotionalWithAssessment(adminAgent, adminCsrf);
    const { agent: memberAgent, person } = await loginAsMember('+237680000008', 'tp8@example.com');

    const earlier = new Date('2026-10-01T10:00:00Z');
    const later = new Date('2026-10-05T10:00:00Z');
    await seedAttempt(person.id, assessmentId, 1, { passed: true, percentage: 60, submittedAt: earlier });
    await seedAttempt(person.id, assessmentId, 2, { passed: true, percentage: 60, submittedAt: later });
    await seedAttempt(person.id, assessmentId, 3, { status: 'IN_PROGRESS' });

    const res = await memberAgent.get('/api/member/me/training-progress');
    expect(new Date(res.body.items[0].lastAttemptAt).toISOString()).toBe(later.toISOString());
  });

  it('a member cannot request another Person\'s progress — identity is always session-derived', async () => {
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-tp9@test.local');
    const { assessmentId } = await makeDevotionalWithAssessment(adminAgent, adminCsrf);
    const { person: otherPerson } = await loginAsMember('+237680000009', 'tp9-other@example.com');
    await seedAttempt(otherPerson.id, assessmentId, 1, { passed: true, percentage: 100 });

    const { agent: memberAgent } = await loginAsMember('+237680000010', 'tp9-self@example.com');
    // The route accepts no personId param at all; sending one anyway must
    // have zero effect since it is never read.
    const res = await memberAgent.get('/api/member/me/training-progress?personId=' + otherPerson.id);
    expect(res.status).toBe(200);
    expect(res.body.items[0].attempted).toBe(false);
    expect(res.body.items[0].completed).toBe(false);
  });
});
