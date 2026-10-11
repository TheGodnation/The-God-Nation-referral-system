import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createLeader } from './helpers';
import { bootstrap } from './testUtils';

// Leader <-> Member identity bridge: an existing Leader's one-time,
// self-serve alternative to the Admin-only link-person action, which also
// creates (or connects to) the real MemberAccount and signs them into the
// Member side (msid) right alongside their existing password session
// (sid). See server/src/routes/leader.ts POST /me/create-member-profile.
const app = createApp();

let ipCounter = 40000;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.119.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) {
    wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', ip);
  }
  return wrapped;
}

async function loginAsLeader(email: string, password = 'password123') {
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  const res = await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password });
  return { agent, csrf, res };
}

describe('Leader <-> Member identity bridge', () => {
  it('requires authentication and CSRF', async () => {
    const anon = agentWithUniqueIp();
    expect((await anon.post('/api/leader/me/create-member-profile').send({ whatsapp: '+237670300001' })).status).toBe(401);

    const { user } = await createLeader('No CSRF Leader', 'nocsrf-bridge@test.local', 'NOCSRFC1');
    const { agent } = await loginAsLeader('nocsrf-bridge@test.local');
    const res = await agent.post('/api/leader/me/create-member-profile').send({ whatsapp: '+237670300001' });
    expect(res.status).toBe(403);
    void user;
  });

  it('rejects an invalid phone number', async () => {
    await createLeader('Bad Phone Leader', 'badphone-bridge@test.local', 'BADPHC1');
    const { agent, csrf } = await loginAsLeader('badphone-bridge@test.local');
    const res = await agent.post('/api/leader/me/create-member-profile').set('X-CSRF-Token', csrf).send({ whatsapp: '12' });
    expect(res.status).toBe(400);
  });

  it('creates a brand-new Person + MemberAccount, links personId, and signs the Leader into the Member side too', async () => {
    const { user } = await createLeader('Fresh Bridge Leader', 'fresh-bridge@test.local', 'FRESHC01');
    const { agent, csrf } = await loginAsLeader('fresh-bridge@test.local');

    const res = await agent.post('/api/leader/me/create-member-profile').set('X-CSRF-Token', csrf).send({ whatsapp: '+237670300002' });
    expect(res.status).toBe(201);
    expect(res.body.personName).toBe('Fresh Bridge Leader');

    const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updatedUser?.personId).toBe(res.body.personId);

    const person = await prisma.person.findUnique({ where: { id: res.body.personId }, include: { memberAccount: true } });
    expect(person?.whatsappNumber).toBe('+237670300002');
    expect(person?.memberAccount?.email).toBe('fresh-bridge@test.local');

    // The same agent is now ALSO signed in as a Member (msid cookie),
    // without affecting its existing Leader (sid) session.
    const memberMe = await agent.get('/api/member/auth/me');
    expect(memberMe.body.member?.personId).toBe(res.body.personId);
    const leaderMe = await agent.get('/api/auth/me');
    expect(leaderMe.body.user?.role).toBe('LEADER');
    expect(leaderMe.body.user?.personId).toBe(res.body.personId);
  });

  it('is one-time: a second attempt is rejected once already linked', async () => {
    await createLeader('Twice Bridge Leader', 'twice-bridge@test.local', 'TWICEC01');
    const { agent, csrf } = await loginAsLeader('twice-bridge@test.local');
    await agent.post('/api/leader/me/create-member-profile').set('X-CSRF-Token', csrf).send({ whatsapp: '+237670300003' });

    const second = await agent.post('/api/leader/me/create-member-profile').set('X-CSRF-Token', csrf).send({ whatsapp: '+237670300004' });
    expect(second.status).toBe(409);
  });

  it('connects to an existing Person (same phone, no MemberAccount yet) instead of creating a duplicate', async () => {
    const existing = await prisma.person.create({ data: { name: 'Old Registrant', whatsappNumber: '+237670300005' } });
    await createLeader('Connect Bridge Leader', 'connect-bridge@test.local', 'CONNECTC1');
    const { agent, csrf } = await loginAsLeader('connect-bridge@test.local');

    const res = await agent.post('/api/leader/me/create-member-profile').set('X-CSRF-Token', csrf).send({ whatsapp: '+237670300005' });
    expect(res.status).toBe(201);
    expect(res.body.personId).toBe(existing.id);

    const account = await prisma.memberAccount.findUnique({ where: { personId: existing.id } });
    expect(account?.email).toBe('connect-bridge@test.local');
  });

  it('rejects when the phone already belongs to a different member account', async () => {
    const other = await prisma.person.create({ data: { name: 'Someone Else', whatsappNumber: '+237670300006' } });
    await prisma.memberAccount.create({ data: { personId: other.id, email: 'someone-else@example.com' } });
    await createLeader('Conflict Bridge Leader', 'conflict-bridge@test.local', 'CONFLICTC1');
    const { agent, csrf } = await loginAsLeader('conflict-bridge@test.local');

    const res = await agent.post('/api/leader/me/create-member-profile').set('X-CSRF-Token', csrf).send({ whatsapp: '+237670300006' });
    expect(res.status).toBe(409);
    const stillUnlinked = await prisma.user.findFirst({ where: { email: 'conflict-bridge@test.local' } });
    expect(stillUnlinked?.personId).toBeNull();
  });

  it("rejects when a different Person's member account already uses the Leader's own email", async () => {
    const other = await prisma.person.create({ data: { name: 'Email Squatter', whatsappNumber: '+237670300007' } });
    await prisma.memberAccount.create({ data: { personId: other.id, email: 'email-bridge@test.local' } });
    await createLeader('Email Conflict Leader', 'email-bridge@test.local', 'EMAILC01');
    const { agent, csrf } = await loginAsLeader('email-bridge@test.local');

    const res = await agent.post('/api/leader/me/create-member-profile').set('X-CSRF-Token', csrf).send({ whatsapp: '+237670300008' });
    expect(res.status).toBe(409);
    expect(await prisma.person.findUnique({ where: { whatsappNumber: '+237670300008' } })).toBeNull();
  });

  it('records an audit entry for the self-link', async () => {
    await createLeader('Audit Bridge Leader', 'audit-bridge@test.local', 'AUDITC01');
    const { agent, csrf } = await loginAsLeader('audit-bridge@test.local');
    await agent.post('/api/leader/me/create-member-profile').set('X-CSRF-Token', csrf).send({ whatsapp: '+237670300009' });

    const entry = await prisma.auditLog.findFirst({ where: { action: 'LEADER_SELF_LINKED_MEMBER_PROFILE', actorEmail: 'audit-bridge@test.local' } });
    expect(entry).not.toBeNull();
  });
});
