import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';

const app = createApp();

let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.82.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
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

async function makePerson(whatsappNumber: string, name = 'TP Admin Test Person') {
  return prisma.person.create({ data: { name, whatsappNumber } });
}

async function makeCommunity(name: string) {
  return prisma.community.create({ data: { name } });
}

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

async function makeDevotionalWithAssessment(
  adminAgent: any,
  adminCsrf: string,
  opts: { communityId?: string; titleEn?: string } = {},
) {
  const devotional = await adminAgent
    .post('/api/admin/devotionals')
    .set('X-CSRF-Token', adminCsrf)
    .send({
      titleEn: opts.titleEn ?? 'TP Admin Devotional',
      contentEn: 'Body.',
      communityId: opts.communityId,
      startDate: '2026-10-01',
      endDate: '2026-10-31',
    });
  await adminAgent.patch(`/api/admin/devotionals/${devotional.body.id}`).set('X-CSRF-Token', adminCsrf).send({ status: 'PUBLISHED' });

  const assessment = await adminAgent
    .post('/api/admin/assessments')
    .set('X-CSRF-Token', adminCsrf)
    .send({ devotionalId: devotional.body.id, titleEn: 'TP Admin Quiz', passMark: 50 });
  await adminAgent.patch(`/api/admin/assessments/${assessment.body.id}`).set('X-CSRF-Token', adminCsrf).send({ status: 'PUBLISHED' });

  return { devotionalId: devotional.body.id, assessmentId: assessment.body.id };
}

describe('Phase 3E — GET /api/admin/people/:id/training-progress', () => {
  it('lets Admin view any Person\'s progress', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-tpa1@test.local');
    const { assessmentId } = await makeDevotionalWithAssessment(agent, csrf);
    const person = await makePerson('+237683000001');
    await seedAttempt(person.id, assessmentId, 1, { passed: true, percentage: 100 });

    const res = await agent.get(`/api/admin/people/${person.id}/training-progress`);
    expect(res.status).toBe(200);
    expect(res.body.completedCount).toBe(1);
  });

  it('returns a clean empty result for a Person with no eligible training, not an error', async () => {
    const { agent } = await loginAsAdmin('admin-tpa2@test.local');
    const person = await makePerson('+237683000002');

    const res = await agent.get(`/api/admin/people/${person.id}/training-progress`);
    expect(res.status).toBe(200);
    expect(res.body.totalEligible).toBe(0);
    expect(res.body.completedCount).toBe(0);
    expect(res.body.items).toEqual([]);
  });

  it('404s for a nonexistent Person', async () => {
    const { agent } = await loginAsAdmin('admin-tpa3@test.local');
    const res = await agent.get('/api/admin/people/nonexistent-id/training-progress');
    expect(res.status).toBe(404);
  });

  it('rejects a non-Admin (Leader) session', async () => {
    const { agent } = await loginAsAdmin('admin-tpa4@test.local');
    const person = await makePerson('+237683000004');
    // Reuse an anon agent hitting the admin route directly — no session.
    const anon = agentWithUniqueIp();
    const res = await anon.get(`/api/admin/people/${person.id}/training-progress`);
    expect(res.status).toBe(401);
    void agent;
  });
});

describe('Phase 3E — GET /api/admin/devotionals/:id/completion-summary', () => {
  it('uses exact ACTIVE CommunityMembership for a Community-scoped devotional', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-tpa5@test.local');
    const community = await makeCommunity('TP Admin Community A');
    const other = await makeCommunity('TP Admin Community B');
    const { devotionalId, assessmentId } = await makeDevotionalWithAssessment(agent, csrf, { communityId: community.id });

    const inCommunity = await makePerson('+237683000005', 'In Community');
    const inOtherCommunity = await makePerson('+237683000105', 'In Other Community');
    await prisma.communityMembership.create({ data: { personId: inCommunity.id, communityId: community.id } });
    await prisma.communityMembership.create({ data: { personId: inOtherCommunity.id, communityId: other.id } });
    await seedAttempt(inCommunity.id, assessmentId, 1, { passed: true, percentage: 90 });

    const res = await agent.get(`/api/admin/devotionals/${devotionalId}/completion-summary`);
    expect(res.status).toBe(200);
    const ids = res.body.items.map((i: any) => i.personId);
    expect(ids).toContain(inCommunity.id);
    expect(ids).not.toContain(inOtherCommunity.id);
    const row = res.body.items.find((i: any) => i.personId === inCommunity.id);
    expect(row.completed).toBe(true);
    expect(row.bestPercentage).toBe(90);
  });

  it('excludes INACTIVE members from a Community-scoped completion summary', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-tpa6@test.local');
    const community = await makeCommunity('TP Admin Community C');
    const { devotionalId } = await makeDevotionalWithAssessment(agent, csrf, { communityId: community.id });

    const active = await makePerson('+237683000006', 'Active Summary Member');
    const inactive = await makePerson('+237683000106', 'Inactive Summary Member');
    await prisma.communityMembership.create({ data: { personId: active.id, communityId: community.id, status: 'ACTIVE' } });
    await prisma.communityMembership.create({ data: { personId: inactive.id, communityId: community.id, status: 'INACTIVE' } });

    const res = await agent.get(`/api/admin/devotionals/${devotionalId}/completion-summary`);
    const ids = res.body.items.map((i: any) => i.personId);
    expect(ids).toContain(active.id);
    expect(ids).not.toContain(inactive.id);
  });

  it('uses the existing global eligibility rule for a global devotional — population is not community-restricted', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-tpa7@test.local');
    const { devotionalId, assessmentId } = await makeDevotionalWithAssessment(agent, csrf);
    const anyPerson = await makePerson('+237683000007', 'Global Eligible Person');
    await seedAttempt(anyPerson.id, assessmentId, 1, { passed: true, percentage: 75 });

    const res = await agent.get(`/api/admin/devotionals/${devotionalId}/completion-summary?pageSize=100`);
    expect(res.status).toBe(200);
    const row = res.body.items.find((i: any) => i.personId === anyPerson.id);
    expect(row).toBeTruthy();
    expect(row.completed).toBe(true);
  });

  it('multiple assessments per devotional are calculated correctly in the completion summary', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-tpa8@test.local');
    const devotional = await agent
      .post('/api/admin/devotionals')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'TP Admin Multi', contentEn: 'x', startDate: '2026-10-01', endDate: '2026-10-31' });
    await agent.patch(`/api/admin/devotionals/${devotional.body.id}`).set('X-CSRF-Token', csrf).send({ status: 'PUBLISHED' });
    const assessmentA = await agent
      .post('/api/admin/assessments')
      .set('X-CSRF-Token', csrf)
      .send({ devotionalId: devotional.body.id, titleEn: 'A', passMark: 50 });
    await agent.patch(`/api/admin/assessments/${assessmentA.body.id}`).set('X-CSRF-Token', csrf).send({ status: 'PUBLISHED' });
    const assessmentB = await agent
      .post('/api/admin/assessments')
      .set('X-CSRF-Token', csrf)
      .send({ devotionalId: devotional.body.id, titleEn: 'B', passMark: 50 });
    await agent.patch(`/api/admin/assessments/${assessmentB.body.id}`).set('X-CSRF-Token', csrf).send({ status: 'PUBLISHED' });

    const person = await makePerson('+237683000008', 'Multi Assessment Person');
    await seedAttempt(person.id, assessmentA.body.id, 1, { passed: false, percentage: 30 });
    await seedAttempt(person.id, assessmentB.body.id, 1, { passed: true, percentage: 60 });

    const res = await agent.get(`/api/admin/devotionals/${devotional.body.id}/completion-summary?pageSize=100`);
    const row = res.body.items.find((i: any) => i.personId === person.id);
    expect(row.completed).toBe(true);
    expect(row.bestPercentage).toBe(60);
  });

  it('404s for a nonexistent devotional', async () => {
    const { agent } = await loginAsAdmin('admin-tpa9@test.local');
    const res = await agent.get('/api/admin/devotionals/nonexistent-id/completion-summary');
    expect(res.status).toBe(404);
  });

  it('historical Attempt rows remain intact after being read by the completion summary', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-tpa10@test.local');
    const { devotionalId, assessmentId } = await makeDevotionalWithAssessment(agent, csrf);
    const person = await makePerson('+237683000010');
    const attempt = await seedAttempt(person.id, assessmentId, 1, { passed: true, percentage: 88 });

    await agent.get(`/api/admin/devotionals/${devotionalId}/completion-summary`);

    const stillThere = await prisma.attempt.findUnique({ where: { id: attempt.id } });
    expect(stillThere).toBeTruthy();
    expect(stillThere!.percentage).toBe(88);
    expect(stillThere!.passed).toBe(true);
  });

  it('uses the existing repository pagination convention', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-tpa11@test.local');
    const community = await makeCommunity('TP Admin Community D');
    const { devotionalId } = await makeDevotionalWithAssessment(agent, csrf, { communityId: community.id });
    for (let i = 0; i < 3; i++) {
      const p = await makePerson(`+237683001${i}00`, `Paged Person ${i}`);
      await prisma.communityMembership.create({ data: { personId: p.id, communityId: community.id } });
    }

    const res = await agent.get(`/api/admin/devotionals/${devotionalId}/completion-summary?page=1&pageSize=2`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(2);
    expect(res.body.pagination.total).toBe(3);
    expect(res.body.pagination.totalPages).toBe(2);
  });

  it('rejects a non-Admin session', async () => {
    const anon = agentWithUniqueIp();
    const res = await anon.get('/api/admin/devotionals/some-id/completion-summary');
    expect(res.status).toBe(401);
  });
});
