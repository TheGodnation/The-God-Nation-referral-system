import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createAdmin } from './helpers';
import { EmailService } from '../lib/email';
import { bootstrap } from './testUtils';

// Admin "Assign as Leader" — the only way a new Leader is created going
// forward (POST /api/admin/leaders, "Create Leader from scratch", is
// retired). Picks an existing Member (by Person id) and creates a Leader
// User pre-linked to that Person, attaching leaderId onto the Person's own
// already-existing ReferralCode — never minting a new one. See admin.ts's
// POST /leaders/assign.
const app = createApp();

async function loginAsAdmin(email = 'assign-admin@test.local') {
  await createAdmin(email, 'AdminPass123!');
  const agent = request.agent(app);
  const { csrf } = await bootstrap(agent);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'AdminPass123!' });
  return { agent, csrf };
}

async function createMember(name: string, whatsapp: string, email: string) {
  const person = await prisma.person.create({ data: { name, whatsappNumber: whatsapp, email } });
  await prisma.memberAccount.create({ data: { personId: person.id, email, passwordHash: 'already-hashed' } });
  return person;
}

describe('POST /api/admin/leaders/assign — Assign an existing Member as Leader', () => {
  it('requires authentication, ADMIN role, and CSRF', async () => {
    const anon = request.agent(app);
    expect((await anon.post('/api/admin/leaders/assign').send({ personId: 'x' })).status).toBe(401);
  });

  it('POST /api/admin/leaders (Create Leader from scratch) is retired and no longer exists', async () => {
    const { agent, csrf } = await loginAsAdmin('retired-admin@test.local');
    const res = await agent
      .post('/api/admin/leaders')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Ghost', email: 'ghost@example.com', referralCode: 'GHOST123' });
    expect(res.status).toBe(404);
  });

  it('rejects an unknown personId', async () => {
    const { agent, csrf } = await loginAsAdmin('assign-unknown@test.local');
    const res = await agent.post('/api/admin/leaders/assign').set('X-CSRF-Token', csrf).send({ personId: 'nope' });
    expect(res.status).toBe(404);
  });

  it('rejects a Person who has not joined as a Member (no MemberAccount)', async () => {
    const person = await prisma.person.create({ data: { name: 'Not A Member Yet', whatsappNumber: '+237670400001' } });
    const { agent, csrf } = await loginAsAdmin('assign-nomember@test.local');
    const res = await agent.post('/api/admin/leaders/assign').set('X-CSRF-Token', csrf).send({ personId: person.id });
    expect(res.status).toBe(400);
  });

  it('rejects a Person already linked to a User', async () => {
    const person = await createMember('Already Linked', '+237670400002', 'already-linked@test.local');
    await prisma.user.create({ data: { name: 'x', email: 'other-linked-user@test.local', passwordHash: 'h', role: 'LEADER', personId: person.id } });
    const { agent, csrf } = await loginAsAdmin('assign-alreadylinked@test.local');
    const res = await agent.post('/api/admin/leaders/assign').set('X-CSRF-Token', csrf).send({ personId: person.id });
    expect(res.status).toBe(409);
  });

  it("creates a Leader User linked to the Person, attaching leaderId onto the Person's existing ReferralCode rather than minting a new one", async () => {
    const person = await createMember('Future Leader', '+237670400003', 'future-leader@test.local');
    // Every Person gets their own code eagerly today, but this fixture
    // mimics a pre-existing Member (created before that was eager).
    const existingCode = await prisma.referralCode.create({ data: { code: 'FUTUREL1', personId: person.id } });

    const { agent, csrf } = await loginAsAdmin('assign-happy@test.local');
    const res = await agent.post('/api/admin/leaders/assign').set('X-CSRF-Token', csrf).send({ personId: person.id });
    expect(res.status).toBe(201);
    expect(res.body.personId).toBe(person.id);

    const leader = await prisma.user.findUnique({ where: { id: res.body.id } });
    expect(leader?.role).toBe('LEADER');
    expect(leader?.active).toBe(true);
    expect(leader?.personId).toBe(person.id);

    const code = await prisma.referralCode.findUnique({ where: { id: existingCode.id } });
    expect(code?.leaderId).toBe(leader!.id);
    expect(code?.code).toBe('FUTUREL1'); // same code — never replaced

    // Only ever one ReferralCode for this Person — no second code minted.
    const allCodesForPerson = await prisma.referralCode.findMany({ where: { personId: person.id } });
    expect(allCodesForPerson).toHaveLength(1);

    const entry = await prisma.auditLog.findFirst({ where: { action: 'LEADER_ASSIGNED_FROM_MEMBER', targetId: leader!.id } });
    expect(entry).not.toBeNull();
  });

  it("creates the Person's referral code on the fly if one somehow doesn't exist yet, rather than failing", async () => {
    const person = await createMember('No Code Yet', '+237670400004', 'nocode-yet@test.local');
    expect(await prisma.referralCode.findUnique({ where: { personId: person.id } })).toBeNull();

    const { agent, csrf } = await loginAsAdmin('assign-nocode@test.local');
    const res = await agent.post('/api/admin/leaders/assign').set('X-CSRF-Token', csrf).send({ personId: person.id });
    expect(res.status).toBe(201);

    const code = await prisma.referralCode.findUnique({ where: { personId: person.id } });
    expect(code?.leaderId).toBe(res.body.id);
  });

  it('fires the one-time "Leadership Dashboard moved" notice to the newly assigned Leader', async () => {
    const person = await createMember('Notice Leader', '+237670400005', 'notice-leader@test.local');
    const { agent, csrf } = await loginAsAdmin('assign-notice@test.local');
    const res = await agent.post('/api/admin/leaders/assign').set('X-CSRF-Token', csrf).send({ personId: person.id });
    expect(res.status).toBe(201);

    const notification = await prisma.notification.findFirst({
      where: { recipientPersonId: person.id, type: 'LEADER_DASHBOARD_MOVED' },
    });
    expect(notification).not.toBeNull();

    const leader = await prisma.user.findUnique({ where: { id: res.body.id } });
    expect(leader?.personLinkNotifiedAt).not.toBeNull();
  });
});

describe('One step: an assembly role also makes the member a Leader', () => {
  it('POST /api/admin/role-assignments gives a member without a Leader account one, and leaves everyone else alone', async () => {
    const { agent, csrf } = await loginAsAdmin('role-leader-admin@test.local');
    const hq = await prisma.community.create({ data: { name: 'Headquarter Assembly' } });
    const member = await createMember('Role Leader', '+237670400101', 'role-leader@test.local');
    const post = (personId: string) => agent.post('/api/admin/role-assignments').set('X-CSRF-Token', csrf).send({ personId, roleType: 'SCOPED_LEADER', communityId: hq.id });

    const first = await post(member.id);
    expect(first.status).toBe(201);
    expect(first.body.leaderAccount).toBe('CREATED');
    const user = await prisma.user.findUniqueOrThrow({ where: { personId: member.id } });
    expect(user).toMatchObject({ role: 'LEADER', active: true, email: 'role-leader@test.local' });
    // Their own referral code now carries the leader.
    expect((await prisma.referralCode.findUniqueOrThrow({ where: { personId: member.id } })).leaderId).toBe(user.id);

    // A second assembly for the same person: nothing new is made.
    const other = await prisma.community.create({ data: { name: 'Buea Assembly' } });
    const second = await agent.post('/api/admin/role-assignments').set('X-CSRF-Token', csrf).send({ personId: member.id, roleType: 'SCOPED_LEADER', communityId: other.id });
    expect(second.status).toBe(201);
    expect(second.body.leaderAccount).toBe('ALREADY');
    expect(await prisma.user.count({ where: { personId: member.id } })).toBe(1);

    // Someone with no member account yet still gets the assembly role; the answer says the dashboard waits.
    const noAccount = await prisma.person.create({ data: { name: 'No Account Yet', whatsappNumber: '+237670400102' } });
    const third = await post(noAccount.id);
    expect(third.status).toBe(201);
    expect(third.body.leaderAccount).toBe('NO_MEMBER_ACCOUNT');
  });

  it('a member who is made a Leader while signed in gets the dashboard without signing out and in', async () => {
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('role-leader-admin2@test.local');
    const hq = await prisma.community.create({ data: { name: 'Pairing Assembly' } });
    const member = await createMember('Pairing Leader', '+237670400103', 'pairing-leader@test.local');
    // The member signs in as an ordinary member (an emailed code).
    const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
    const memberAgent = request.agent(app);
    const { csrf } = await bootstrap(memberAgent);
    await memberAgent.post('/api/member/auth/request-code').set('X-CSRF-Token', csrf).send({ email: 'pairing-leader@test.local' });
    const code = spy.mock.calls[0][0].code as string;
    spy.mockRestore();
    await memberAgent.post('/api/member/auth/verify-code').set('X-CSRF-Token', csrf).send({ email: 'pairing-leader@test.local', code });
    expect((await memberAgent.get('/api/auth/me')).body.user).toBeNull();

    // The admin gives the assembly role. The member, still signed in, now has the Leader session.
    await adminAgent.post('/api/admin/role-assignments').set('X-CSRF-Token', adminCsrf).send({ personId: member.id, roleType: 'SCOPED_LEADER', communityId: hq.id });
    const me = await memberAgent.get('/api/auth/me');
    expect(me.body.user).toMatchObject({ role: 'LEADER', personId: member.id });
    // And it stays: the next call finds the session already there.
    expect((await memberAgent.get('/api/auth/me')).body.user.role).toBe('LEADER');
  });
});
