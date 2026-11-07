import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';

// "Who did the teachings": everyone who handed in the quiz of at least one teaching, how many they did and whether they
// passed each, whatever the mark — for choosing leaders. Handing in counts; passing is separate.
const app = createApp();
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
async function person(name: string, extra: Record<string, unknown> = {}) {
  n += 1;
  return prisma.person.create({ data: { name, whatsappNumber: `+2376653${String(n).padStart(5, '0')}`, profileCompletedAt: new Date(), ...extra } });
}
async function memberLogin(p: { id: string }) {
  n += 1;
  const email = `tc${n}@example.com`;
  await prisma.memberAccount.create({ data: { personId: p.id, email } });
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/member/auth/request-code').set('X-CSRF-Token', csrf).send({ email });
  const code = spy.mock.calls[0][0].code as string;
  spy.mockRestore();
  await agent.post('/api/member/auth/verify-code').set('X-CSRF-Token', csrf).send({ email, code });
  return { agent, csrf };
}

async function world() {
  const admin = await createAdmin(`tc-admin${++n}@test.local`, 'AdminPass123!');
  const community = await prisma.community.create({ data: { name: `Teaching Assembly ${n}` } });
  const other = await prisma.community.create({ data: { name: `Other Assembly ${n}` } });
  const author = await person('Teacher');
  const teachings: { id: string; assessmentId: string }[] = [];
  const make = async (communityId: string, title: string) => {
    const conv = (await prisma.conversation.findUnique({ where: { communityId } })) ?? (await prisma.conversation.create({ data: { communityId } }));
    const message = await prisma.message.create({ data: { conversationId: conv.id, senderPersonId: author.id, body: title } });
    const assessment = await prisma.assessment.create({ data: { titleEn: `Quiz ${title}`, passMark: 70, status: 'PUBLISHED' } });
    return prisma.teaching.create({
      data: { communityId, messageId: message.id, assessmentId: assessment.id, authorPersonId: author.id, title, text: 'x', closesAt: new Date(Date.now() + 86_400_000) },
      select: { id: true, assessmentId: true },
    });
  };
  for (const title of ['Teaching 1', 'Teaching 2', 'Teaching 3']) teachings.push(await make(community.id, title));
  const elsewhere = await make(other.id, 'Elsewhere 1');
  const take = (personId: string, t: { assessmentId: string }, percentage: number, attemptNumber = 1, submitted = true) =>
    prisma.attempt.create({
      data: {
        personId, assessmentId: t.assessmentId, attemptNumber, status: submitted ? 'SUBMITTED' : 'IN_PROGRESS', submittedAt: submitted ? new Date() : null,
        score: percentage / 10, maxScore: 10, percentage, passMarkAtAttempt: 70, passed: percentage >= 70,
      },
    });
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: admin.email, password: 'AdminPass123!' });
  return { admin, community, other, teachings, elsewhere, take, central: { agent, csrf } };
}

describe('who did the teachings', () => {
  it('lists everyone who handed in at least one quiz, counts them, and keeps "did it" apart from "passed it"', async () => {
    const w = await world();
    const all = await person('Did All');
    const two = await person('Did Two');
    const one = await person('Did One');
    const none = await person('Did None');
    await w.take(all.id, w.teachings[0], 90);
    await w.take(all.id, w.teachings[1], 40); // did it, did not pass
    await w.take(all.id, w.teachings[2], 70);
    await w.take(two.id, w.teachings[0], 100);
    await w.take(two.id, w.teachings[2], 20);
    // A retake of the same teaching counts once, with the best mark.
    await w.take(one.id, w.teachings[1], 30, 1);
    await w.take(one.id, w.teachings[1], 80, 2);
    // Not handed in (still in progress) does not count.
    await w.take(none.id, w.teachings[0], 100, 1, false);

    const res = await w.central.agent.get(`/api/admin/teaching-completion?communityId=${w.community.id}`);
    expect(res.status).toBe(200);
    expect(res.body.teachings.map((t: any) => t.title)).toEqual(['Teaching 1', 'Teaching 2', 'Teaching 3']);
    expect(res.body).toMatchObject({ tookAll: 1, tookAny: 3 });
    const names = res.body.people.map((p: any) => [p.name, p.took, p.passed]);
    expect(names).toEqual([['Did All', 3, 2], ['Did Two', 2, 1], ['Did One', 1, 1]]);
    const one_ = res.body.people.find((p: any) => p.name === 'Did One');
    expect(one_.results[w.teachings[1].id]).toMatchObject({ percentage: 80, passed: true });
    expect(one_.results[w.teachings[0].id]).toBeNull();
    const all_ = res.body.people.find((p: any) => p.name === 'Did All');
    expect(all_.results[w.teachings[1].id]).toMatchObject({ percentage: 40, passed: false });
    expect(res.body.people.some((p: any) => p.name === 'Did None')).toBe(false);
  });

  it('keeps assemblies apart, hides test people unless asked, and shows who already leads', async () => {
    const w = await world();
    const real = await person('Real Person');
    const test = await person('Test Person', { isTestData: true });
    await w.take(real.id, w.teachings[0], 80);
    await w.take(real.id, w.elsewhere, 80);
    await w.take(test.id, w.teachings[0], 80);
    await prisma.roleAssignment.create({ data: { personId: real.id, roleType: 'SCOPED_LEADER', communityId: w.other.id, assignedByUserId: w.admin.id } });

    const here = (await w.central.agent.get(`/api/admin/teaching-completion?communityId=${w.community.id}`)).body;
    expect(here.people.map((p: any) => p.name)).toEqual(['Real Person']);
    expect(here.people[0].took).toBe(1); // the teaching in the other assembly is not counted here
    expect(here.people[0].leads).toEqual([w.other.name]);
    const withTest = (await w.central.agent.get(`/api/admin/teaching-completion?communityId=${w.community.id}&includeTestData=true`)).body;
    expect(withTest.people.map((p: any) => p.name).sort()).toEqual(['Real Person', 'Test Person']);
    const everywhere = (await w.central.agent.get('/api/admin/teaching-completion')).body;
    expect(everywhere.teachings).toHaveLength(4);
    const assemblies = (await w.central.agent.get('/api/admin/teaching-completion/assemblies')).body.items;
    expect(assemblies.find((a: any) => a.id === w.community.id).teachings).toBe(3);
  });

  it('downloads the list as a spreadsheet, and appoints a person as leader once', async () => {
    const w = await world();
    const grace = await person('=HYPERLINK("x")');
    await prisma.communityMembership.create({ data: { personId: grace.id, communityId: w.community.id, status: 'ACTIVE' } });
    await w.take(grace.id, w.teachings[0], 90);
    await w.take(grace.id, w.teachings[1], 10);
    const csv = await w.central.agent.get(`/api/admin/teaching-completion/export?communityId=${w.community.id}`);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain('Teaching 1,Teaching 2,Teaching 3');
    expect(csv.text).toContain('2 of 3');
    expect(csv.text).toContain('90% PASSED');
    expect(csv.text).toContain('10% NOT PASSED');
    expect(csv.text).toContain('not done');
    expect(csv.text).toContain("'=HYPERLINK"); // never a live formula in a spreadsheet

    const appoint = () => w.central.agent.post('/api/admin/teaching-completion/appoint').set('X-CSRF-Token', w.central.csrf).send({ personId: grace.id, communityId: w.community.id });
    expect((await appoint()).status).toBe(201);
    expect(await prisma.roleAssignment.count({ where: { personId: grace.id, communityId: w.community.id, roleType: 'SCOPED_LEADER', status: 'ACTIVE' } })).toBe(1);
    expect((await appoint()).status).toBe(409);
    expect(await prisma.auditLog.count({ where: { action: 'TEACHING_COMPLETION_EXPORTED' } })).toBe(1);
  });

  it('reopens the teachings for people who came late, for the whole assembly or chosen teachings, and never shortens a later date', async () => {
    const w = await world();
    const past = new Date(Date.now() - 3 * 86_400_000);
    await prisma.teaching.updateMany({ where: { id: { in: w.teachings.map((t) => t.id) } }, data: { closesAt: past } });
    const before = (await w.central.agent.get(`/api/admin/teaching-completion?communityId=${w.community.id}`)).body;
    expect(before.teachings.every((t: any) => new Date(t.closesAt) < new Date())).toBe(true);

    // One teaching, then the whole assembly.
    const one = await w.central.agent.post('/api/admin/teaching-completion/reopen').set('X-CSRF-Token', w.central.csrf).send({ teachingIds: [w.teachings[0].id], days: 5 });
    expect(one.body.reopened).toBe(1);
    const all = await w.central.agent.post('/api/admin/teaching-completion/reopen').set('X-CSRF-Token', w.central.csrf).send({ communityId: w.community.id, days: 3 });
    expect(all.body.reopened).toBe(2); // the first is already open for longer, so it is left as it is
    const after = (await w.central.agent.get(`/api/admin/teaching-completion?communityId=${w.community.id}`)).body;
    const days = after.teachings.map((t: any) => Math.round((new Date(t.closesAt).getTime() - Date.now()) / 86_400_000));
    expect(days).toEqual([5, 3, 3]);
    // The other assembly's teaching is untouched.
    expect((await prisma.teaching.findUniqueOrThrow({ where: { id: w.elsewhere.id } })).closesAt.getTime()).toBeGreaterThan(Date.now());
    expect(await prisma.auditLog.count({ where: { action: 'TEACHINGS_REOPENED' } })).toBe(2);
    // Bad requests are refused.
    expect((await w.central.agent.post('/api/admin/teaching-completion/reopen').set('X-CSRF-Token', w.central.csrf).send({ days: 3 })).status).toBe(400);
    expect((await w.central.agent.post('/api/admin/teaching-completion/reopen').set('X-CSRF-Token', w.central.csrf).send({ communityId: w.community.id, days: 0 })).status).toBe(400);
    expect((await w.central.agent.post('/api/admin/teaching-completion/reopen').set('X-CSRF-Token', w.central.csrf).send({ communityId: w.community.id, days: 90 })).status).toBe(400);
  });

  it('a member who came late can take the quiz once it is reopened', async () => {
    const w = await world();
    const late = await person('Late Joiner');
    const { agent } = await memberLogin(late);
    const teaching = w.teachings[0];
    await prisma.communityMembership.create({ data: { personId: late.id, communityId: w.community.id, status: 'ACTIVE' } });
    await prisma.teaching.update({ where: { id: teaching.id }, data: { closesAt: new Date(Date.now() - 86_400_000) } });
    await prisma.teachingProgress.create({ data: { teachingId: teaching.id, personId: late.id, completedAt: new Date() } });
    const closed = await agent.get(`/api/teachings/${teaching.id}`);
    expect(closed.status).toBe(200);
    expect(closed.body.quiz.state).toBe('CLOSED');
    await w.central.agent.post('/api/admin/teaching-completion/reopen').set('X-CSRF-Token', w.central.csrf).send({ teachingIds: [teaching.id], days: 7 });
    const open = await agent.get(`/api/teachings/${teaching.id}`);
    expect(open.body.quiz.state).toBe('AVAILABLE');
  });

  it('is for the central admin only, in the dashboard and in the member profile', async () => {
    const w = await world();
    const leader = await person('Some Leader');
    const lm = await memberLogin(leader);
    expect((await lm.agent.get('/api/member/central-teaching-completion')).status).toBe(403);
    expect((await lm.agent.post('/api/member/central-teaching-completion/appoint').set('X-CSRF-Token', lm.csrf).send({ personId: leader.id, communityId: w.community.id })).status).toBe(403);
    expect((await agentWithUniqueIp().get('/api/admin/teaching-completion')).status).toBe(401);

    const nc = await person('National Coordinator');
    await prisma.user.update({ where: { id: w.admin.id }, data: { personId: nc.id } });
    const ncm = await memberLogin(nc);
    const res = await ncm.agent.get(`/api/member/central-teaching-completion?communityId=${w.community.id}`);
    expect(res.status).toBe(200);
    expect(res.body.teachings).toHaveLength(3);
  });
});
