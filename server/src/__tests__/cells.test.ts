import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { createAdmin, createLeader } from './helpers';
import { bootstrap } from './testUtils';

// Cells: "Ready to lead" per assembly (members who passed every Leadership
// School exam and do not lead yet), one-tap appointment with NO limit on
// leaders per assembly, in the admin dashboard AND the central admin's own
// member profile; the adjustable assembly size; and the removed
// "leaders recommend leaders" feature.
const app = createApp();

let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.141.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', ip);
  return wrapped;
}

let n = 0;
async function person(name: string, communityId?: string) {
  n += 1;
  const p = await prisma.person.create({
    data: { name: `${name} ${n}`, whatsappNumber: `+2376588${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() },
  });
  if (communityId) await prisma.communityMembership.create({ data: { personId: p.id, communityId, status: 'ACTIVE' } });
  return p;
}

async function memberSignIn(personId: string) {
  const email = `cells${personId.slice(0, 8)}@example.com`;
  await prisma.memberAccount.create({ data: { personId, email } });
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/member/auth/request-code').set('X-CSRF-Token', csrf).send({ email });
  const code = spy.mock.calls[0][0].code as string;
  spy.mockRestore();
  await agent.post('/api/member/auth/verify-code').set('X-CSRF-Token', csrf).send({ email, code });
  return { agent, csrf };
}

async function adminSignIn() {
  await createAdmin('cells-admin@test.local', 'AdminPass123!');
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: 'cells-admin@test.local', password: 'AdminPass123!' });
  return { agent, csrf, user: (await prisma.user.findUnique({ where: { email: 'cells-admin@test.local' } }))! };
}

/** Two Leadership Academy books with published exams. */
async function school() {
  const exams: string[] = [];
  for (const order of [1, 2]) {
    const book = await prisma.libraryBook.create({ data: { kind: 'TRAINING', titleEn: `Book ${order}`, trainingOrder: order } });
    const exam = await prisma.assessment.create({ data: { titleEn: `Exam ${order}`, passMark: 70, status: 'PUBLISHED', trainingBookId: book.id } });
    exams.push(exam.id);
  }
  return exams;
}

async function passes(personId: string, examIds: string[]) {
  for (const assessmentId of examIds) {
    await prisma.attempt.create({
      data: { personId, assessmentId, attemptNumber: 1, status: 'SUBMITTED', submittedAt: new Date(), passed: true, percentage: 90, score: 9, maxScore: 10 },
    });
  }
}

describe('Ready to lead — admin dashboard', () => {
  it('lists only members who finished the whole school and do not lead yet', async () => {
    const exams = await school();
    const a = await prisma.community.create({ data: { name: 'Assembly A' } });
    const b = await prisma.community.create({ data: { name: 'Assembly B' } });
    const graduate = await person('Graduate', a.id);
    const half = await person('Half way', a.id);
    const leader = await person('Already leads', a.id);
    const elsewhere = await person('Other assembly', b.id);
    await passes(graduate.id, exams);
    await passes(half.id, [exams[0]]);
    await passes(leader.id, exams);
    await passes(elsewhere.id, exams);
    const { agent, user } = await adminSignIn();
    await prisma.roleAssignment.create({ data: { personId: leader.id, roleType: 'SCOPED_LEADER', communityId: a.id, assignedByUserId: user.id } });

    const list = await agent.get(`/api/admin/cells/ready-to-lead?communityId=${a.id}`);
    expect(list.status).toBe(200);
    expect(list.body.requiredBooks).toBe(2);
    expect(list.body.items.map((i: any) => i.personId)).toEqual([graduate.id]);

    const overview = await agent.get('/api/admin/cells/overview');
    expect(overview.status).toBe(200);
    expect(overview.body.capacity).toBe(200);
    const rowA = overview.body.items.find((r: any) => r.id === a.id);
    expect(rowA).toMatchObject({ members: 3, leaders: 1, readyToLead: 1 });
    expect(overview.body.items.find((r: any) => r.id === b.id)).toMatchObject({ members: 1, leaders: 0, readyToLead: 1 });
  });

  it('shows nobody as ready while no school exam exists', async () => {
    const a = await prisma.community.create({ data: { name: 'Assembly A' } });
    await person('Member', a.id);
    const { agent } = await adminSignIn();
    const list = await agent.get(`/api/admin/cells/ready-to-lead?communityId=${a.id}`);
    expect(list.body).toEqual({ requiredBooks: 0, items: [] });
  });

  it('appoints a leader (notified, recorded) and never limits how many an assembly has', async () => {
    const exams = await school();
    const a = await prisma.community.create({ data: { name: 'Assembly A' } });
    const { agent, csrf, user } = await adminSignIn();

    const people = [];
    for (let i = 0; i < 8; i++) {
      const p = await person('Candidate', a.id);
      await passes(p.id, exams);
      people.push(p);
    }
    for (const p of people) {
      const res = await agent.post('/api/admin/cells/appoint').set('X-CSRF-Token', csrf).send({ personId: p.id, communityId: a.id });
      expect(res.status).toBe(201);
    }
    expect(await prisma.roleAssignment.count({ where: { communityId: a.id, status: 'ACTIVE' } })).toBe(8);
    const first = await prisma.roleAssignment.findFirstOrThrow({ where: { personId: people[0].id } });
    expect(first.assignedByUserId).toBe(user.id);
    expect(await prisma.notification.count({ where: { recipientPersonId: people[0].id, type: 'ROLE_ASSIGNED' } })).toBe(1);

    const again = await agent.post('/api/admin/cells/appoint').set('X-CSRF-Token', csrf).send({ personId: people[0].id, communityId: a.id });
    expect(again.status).toBe(409);

    const list = await agent.get(`/api/admin/cells/ready-to-lead?communityId=${a.id}`);
    expect(list.body.items).toEqual([]);
  });

  it('is closed to everyone but the admin', async () => {
    const anon = agentWithUniqueIp();
    expect((await anon.get('/api/admin/cells/overview')).status).toBe(401);
    const a = await prisma.community.create({ data: { name: 'Assembly A' } });
    const ordinary = await person('Ordinary', a.id);
    const m = await memberSignIn(ordinary.id);
    expect((await m.agent.get('/api/admin/cells/overview')).status).toBe(401);
    expect((await m.agent.get('/api/member/central-cells/overview')).status).toBe(403);
    expect(
      (await m.agent.post('/api/member/central-cells/appoint').set('X-CSRF-Token', m.csrf).send({ personId: ordinary.id, communityId: a.id })).status,
    ).toBe(403);
  });
});

describe('Ready to lead — the central admin in his own member profile', () => {
  it('sees the same lists and appoints leaders as himself', async () => {
    const exams = await school();
    const a = await prisma.community.create({ data: { name: 'Assembly A' } });
    const ownerPerson = await person('Owner', a.id);
    const admin = await createAdmin('owner@test.local', 'AdminPass123!');
    await prisma.user.update({ where: { id: admin.id }, data: { personId: ownerPerson.id } });
    const candidate = await person('Candidate', a.id);
    await passes(candidate.id, exams);

    const m = await memberSignIn(ownerPerson.id);
    const list = await m.agent.get(`/api/member/central-cells/ready-to-lead?communityId=${a.id}`);
    expect(list.status).toBe(200);
    expect(list.body.items.map((i: any) => i.personId)).toEqual([candidate.id]);

    const res = await m.agent.post('/api/member/central-cells/appoint').set('X-CSRF-Token', m.csrf).send({ personId: candidate.id, communityId: a.id });
    expect(res.status).toBe(201);
    const role = await prisma.roleAssignment.findFirstOrThrow({ where: { personId: candidate.id } });
    expect(role.assignedByUserId).toBe(admin.id);
    expect((await m.agent.get('/api/member/central-cells/overview')).body.items.find((r: any) => r.id === a.id)).toMatchObject({ leaders: 1, readyToLead: 0 });

    // …and sets the assembly size from his own profile too.
    const size = await m.agent.put('/api/member/central-cells/capacity').set('X-CSRF-Token', m.csrf).send({ assemblyCapacity: 120 });
    expect(size.status).toBe(200);
    expect((await m.agent.get('/api/member/central-cells/overview')).body.capacity).toBe(120);
    expect((await m.agent.put('/api/member/central-cells/capacity').set('X-CSRF-Token', m.csrf).send({ assemblyCapacity: 3 })).status).toBe(400);
    const me = await m.agent.get('/api/member/auth/me');
    expect(me.body.member.isCentralAdmin).toBe(true);
  });
});

describe('Assembly size setting', () => {
  it('saves a new capacity, keeps the placement mode, and refuses nonsense', async () => {
    const { agent, csrf } = await adminSignIn();
    const ok = await agent.put('/api/admin/communities/placement-settings').set('X-CSRF-Token', csrf).send({ placementMode: 'SMALLEST_GROUP', assemblyCapacity: 150 });
    expect(ok.status).toBe(200);
    expect(ok.body.assemblyCapacity).toBe(150);
    expect((await agent.get('/api/admin/communities/placement-settings')).body).toEqual({ placementMode: 'SMALLEST_GROUP', assemblyCapacity: 150 });

    const modeOnly = await agent.put('/api/admin/communities/placement-settings').set('X-CSRF-Token', csrf).send({ placementMode: 'BY_LOCATION' });
    expect(modeOnly.body).toEqual({ placementMode: 'BY_LOCATION', assemblyCapacity: 150 });

    for (const bad of [5, 99999, 12.5]) {
      const res = await agent.put('/api/admin/communities/placement-settings').set('X-CSRF-Token', csrf).send({ placementMode: 'SMALLEST_GROUP', assemblyCapacity: bad });
      expect(res.status).toBe(400);
    }
  });
});

describe('"Leaders recommend leaders" is gone', () => {
  it('has no leader or admin recommendation endpoints any more', async () => {
    const { agent } = await adminSignIn();
    expect((await agent.get('/api/admin/organizational-leadership-recommendations')).status).toBe(404);

    const { user: leaderUser } = await createLeader('Some Leader', 'someleader@test.local', 'SOMELEAD1');
    const leaderPerson = await person('Some Leader');
    await prisma.user.update({ where: { id: leaderUser.id }, data: { personId: leaderPerson.id } });
    const leader = agentWithUniqueIp();
    const { csrf } = await bootstrap(leader as any);
    await leader.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: 'someleader@test.local', password: 'password123' });
    expect((await leader.get('/api/leader/organizational-leadership-recommendations')).status).toBe(404);
  });
});
