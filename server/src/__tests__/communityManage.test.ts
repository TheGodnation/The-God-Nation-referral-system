import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { bootstrap } from './testUtils';

// The central admin's member profile can make a private sub-assembly and add
// people to it, from the app.
const app = createApp();
const PASSWORD = 'GoodPass123!';
let n = 0;

function agentWithIp() {
  n += 1;
  const raw = request.agent(app);
  const ip = `10.152.${Math.floor(n / 256)}.${n % 256}`;
  const methods = ['get', 'post', 'delete'] as const;
  const w = {} as Record<(typeof methods)[number], (p: string) => request.Test>;
  for (const m of methods) w[m] = (p: string) => raw[m](p).set('X-Forwarded-For', ip);
  return w;
}

async function signedIn(name: string, opts: { admin?: boolean; communityId?: string } = {}) {
  n += 1;
  const email = `manage${n}@example.com`;
  const person = await prisma.person.create({ data: { name: `${name} ${n}`, whatsappNumber: `+2376590${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() } });
  await prisma.memberAccount.create({ data: { personId: person.id, email, passwordHash: await bcrypt.hash(PASSWORD, 4) } });
  if (opts.admin) await prisma.user.create({ data: { name: 'Central Admin', email: `manage-admin-${n}@test.local`, passwordHash: 'x', role: 'ADMIN', personId: person.id } });
  if (opts.communityId) await prisma.communityMembership.create({ data: { personId: person.id, communityId: opts.communityId, status: 'ACTIVE' } });
  const agent = agentWithIp();
  const { csrf } = await bootstrap(agent as any);
  if (opts.admin) {
    const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
    await agent.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email, password: PASSWORD });
    const code = spy.mock.calls[spy.mock.calls.length - 1][0].code as string;
    await agent.post('/api/member/auth/verify-code').set('X-CSRF-Token', csrf).send({ email, code });
    spy.mockRestore();
  } else {
    await agent.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email, password: PASSWORD });
  }
  return { person, agent, csrf };
}

afterEach(() => vi.restoreAllMocks());

describe('Sub-assemblies and adding people from the app', () => {
  it('the central admin makes a private sub-assembly inside this one; nobody else can', async () => {
    const hq = await prisma.community.create({ data: { name: 'HQ' } });
    const admin = await signedIn('Coordinator', { admin: true });
    const member = await signedIn('Member', { communityId: hq.id });

    const denied = await member.agent.post(`/api/communities/${hq.id}/sub-assemblies`).set('X-CSRF-Token', member.csrf).send({ name: 'Secret' });
    expect(denied.status).toBe(403);
    expect((await admin.agent.post(`/api/communities/${hq.id}/sub-assemblies`).set('X-CSRF-Token', admin.csrf).send({ name: '  ' })).status).toBe(400);

    const made = await admin.agent.post(`/api/communities/${hq.id}/sub-assemblies`).set('X-CSRF-Token', admin.csrf).send({ name: 'HQ Leaders' });
    expect(made.status).toBe(201);
    const child = await prisma.community.findUniqueOrThrow({ where: { id: made.body.id }, include: { conversation: true } });
    expect(child).toMatchObject({ name: 'HQ Leaders', parentId: hq.id, autoPlacementEligible: false });
    expect(child.conversation).not.toBeNull();
    // Being in HQ does not open it.
    expect((await member.agent.get(`/api/communities/${child.id}/conversation`)).status).toBe(403);
    // The coordinator's profile sees it.
    expect((await admin.agent.get(`/api/communities/${child.id}/conversation`)).status).toBe(200);
    expect((await admin.agent.get(`/api/communities/${child.id}/conversation`)).body.canManage).toBe(true);
  });

  it('finds people by name or number and adds them, once', async () => {
    const hq = await prisma.community.create({ data: { name: 'HQ' } });
    const admin = await signedIn('Coordinator', { admin: true });
    const child = await prisma.community.create({ data: { name: 'Sub', parentId: hq.id, autoPlacementEligible: false } });
    const ann = await signedIn('Ann Fon');
    const ben = await signedIn('Ben Ngu', { communityId: child.id });
    await prisma.person.update({ where: { id: ann.person.id }, data: { name: 'Zed Findable' } });

    expect((await ann.agent.get(`/api/communities/${child.id}/people-search?q=Zed`)).status).toBe(403);
    expect((await admin.agent.get(`/api/communities/${child.id}/people-search?q=Z`)).status).toBe(400);

    const found = await admin.agent.get(`/api/communities/${child.id}/people-search?q=zed`);
    expect(found.body.items).toEqual([expect.objectContaining({ id: ann.person.id, name: 'Zed Findable', isMember: false })]);
    const bens = await admin.agent.get(`/api/communities/${child.id}/people-search?q=Ben`);
    expect(bens.body.items.find((i: any) => i.id === ben.person.id).isMember).toBe(true);

    const added = await admin.agent.post(`/api/communities/${child.id}/members`).set('X-CSRF-Token', admin.csrf).send({ personId: ann.person.id });
    expect(added.status).toBe(201);
    expect((await ann.agent.get(`/api/communities/${child.id}/conversation`)).status).toBe(200);
    expect((await admin.agent.post(`/api/communities/${child.id}/members`).set('X-CSRF-Token', admin.csrf).send({ personId: ann.person.id })).body.code).toBe('ALREADY_MEMBER');

    // Someone who left is brought back.
    await prisma.communityMembership.updateMany({ where: { personId: ann.person.id, communityId: child.id }, data: { status: 'INACTIVE' } });
    expect((await admin.agent.post(`/api/communities/${child.id}/members`).set('X-CSRF-Token', admin.csrf).send({ personId: ann.person.id })).status).toBe(201);
    expect(await prisma.communityMembership.count({ where: { personId: ann.person.id, communityId: child.id, status: 'ACTIVE' } })).toBe(1);
  });
});

describe('Taking people out of an assembly or group from the app', () => {
  it('the central admin removes a member from THIS place only; they can be added back; nobody else can', async () => {
    const hq = await prisma.community.create({ data: { name: 'HQ' } });
    const group = await prisma.community.create({ data: { name: 'HQ Leaders', parentId: hq.id } });
    const admin = await signedIn('Coordinator', { admin: true });
    const member = await signedIn('Member', { communityId: hq.id });
    await prisma.communityMembership.create({ data: { personId: member.person.id, communityId: group.id, status: 'ACTIVE' } });
    const other = await signedIn('Other', { communityId: hq.id });

    // Not the central admin: refused.
    expect((await other.agent.delete(`/api/communities/${group.id}/members/${member.person.id}`).set('X-CSRF-Token', other.csrf)).status).toBe(403);

    const removed = await admin.agent.delete(`/api/communities/${group.id}/members/${member.person.id}`).set('X-CSRF-Token', admin.csrf);
    expect(removed.status).toBe(200);
    const inGroup = await prisma.communityMembership.findUniqueOrThrow({ where: { personId_communityId: { personId: member.person.id, communityId: group.id } } });
    const inHq = await prisma.communityMembership.findUniqueOrThrow({ where: { personId_communityId: { personId: member.person.id, communityId: hq.id } } });
    expect(inGroup.status).toBe('INACTIVE');
    expect(inHq.status).toBe('ACTIVE'); // only this place

    // Removing again says they are not in it; the search no longer calls them a member; adding back works.
    expect((await admin.agent.delete(`/api/communities/${group.id}/members/${member.person.id}`).set('X-CSRF-Token', admin.csrf)).status).toBe(404);
    const found = await admin.agent.get(`/api/communities/${group.id}/people-search?q=${encodeURIComponent(member.person.name)}`);
    expect(found.body.items.find((i: any) => i.id === member.person.id)?.isMember).toBe(false);
    expect((await admin.agent.post(`/api/communities/${group.id}/members`).set('X-CSRF-Token', admin.csrf).send({ personId: member.person.id })).status).toBe(201);
  });

  it('never removes the central admin, nor a leader of that very place (end the leader role first)', async () => {
    const hq = await prisma.community.create({ data: { name: 'HQ' } });
    const admin = await signedIn('Coordinator', { admin: true, communityId: hq.id });
    const leader = await signedIn('Leader', { communityId: hq.id });
    const user = await prisma.user.create({ data: { name: 'L', email: `leader-${Date.now()}@test.local`, passwordHash: 'x', role: 'LEADER', personId: leader.person.id } });
    await prisma.roleAssignment.create({ data: { personId: leader.person.id, roleType: 'SCOPED_LEADER', assignedByUserId: user.id, communityId: hq.id, status: 'ACTIVE' } });

    const self = await admin.agent.delete(`/api/communities/${hq.id}/members/${admin.person.id}`).set('X-CSRF-Token', admin.csrf);
    expect(self.status).toBe(409);
    expect(self.body.code).toBe('PROTECTED');
    const lead = await admin.agent.delete(`/api/communities/${hq.id}/members/${leader.person.id}`).set('X-CSRF-Token', admin.csrf);
    expect(lead.status).toBe(409);
    expect(lead.body.code).toBe('IS_LEADER');
    expect((await prisma.communityMembership.findUniqueOrThrow({ where: { personId_communityId: { personId: leader.person.id, communityId: hq.id } } })).status).toBe('ACTIVE');
  });
});

