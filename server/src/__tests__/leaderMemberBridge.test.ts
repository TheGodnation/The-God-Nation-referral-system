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
    expect((await anon.post('/api/leader/me/create-member-profile').send({ whatsapp: '+237670300001', password: 'Testpass123' })).status).toBe(401);

    const { user } = await createLeader('No CSRF Leader', 'nocsrf-bridge@test.local', 'NOCSRFC1');
    const { agent } = await loginAsLeader('nocsrf-bridge@test.local');
    const res = await agent.post('/api/leader/me/create-member-profile').send({ whatsapp: '+237670300001', password: 'Testpass123' });
    expect(res.status).toBe(403);
    void user;
  });

  it('opens the leader’s member profile from the dashboard session alone, with no second sign-in', async () => {
    await createLeader('Open Leader', 'open-bridge@test.local', 'OPENC001');
    const first = await loginAsLeader('open-bridge@test.local');
    const created = await first.agent.post('/api/leader/me/create-member-profile').set('X-CSRF-Token', first.csrf).send({ whatsapp: '+237670300077', password: 'Testpass123' });
    expect(created.status).toBe(201);

    // A fresh browser session: dashboard sign-in only.
    const later = await loginAsLeader('open-bridge@test.local');
    expect((await later.agent.get('/api/member/auth/me')).body.member).toBeNull();
    const res = await later.agent.post('/api/leader/me/open-member-profile').set('X-CSRF-Token', later.csrf);
    expect(res.status).toBe(200);
    expect((await later.agent.get('/api/member/auth/me')).body.member?.personId).toBe(created.body.personId);

    // A leader with no member profile is told so.
    await createLeader('Plain Leader', 'plain-open@test.local', 'OPENC002');
    const plain = await loginAsLeader('plain-open@test.local');
    const none = await plain.agent.post('/api/leader/me/open-member-profile').set('X-CSRF-Token', plain.csrf);
    expect(none.status).toBe(404);
    expect(none.body.code).toBe('NO_MEMBER_PROFILE');
  });

  it('rejects an invalid phone number', async () => {
    await createLeader('Bad Phone Leader', 'badphone-bridge@test.local', 'BADPHC1');
    const { agent, csrf } = await loginAsLeader('badphone-bridge@test.local');
    const res = await agent.post('/api/leader/me/create-member-profile').set('X-CSRF-Token', csrf).send({ whatsapp: '12', password: 'Testpass123' });
    expect(res.status).toBe(400);
  });

  it('rejects a password under 8 characters', async () => {
    await createLeader('Short Pass Leader', 'shortpass-bridge@test.local', 'SHORTC01');
    const { agent, csrf } = await loginAsLeader('shortpass-bridge@test.local');
    const res = await agent.post('/api/leader/me/create-member-profile').set('X-CSRF-Token', csrf).send({ whatsapp: '+237670300010', password: 'short' });
    expect(res.status).toBe(400);
  });

  it('creates a brand-new Person + MemberAccount with a real password, links personId, and signs the Leader into the Member side too', async () => {
    const { user } = await createLeader('Fresh Bridge Leader', 'fresh-bridge@test.local', 'FRESHC01');
    const { agent, csrf } = await loginAsLeader('fresh-bridge@test.local');

    const res = await agent.post('/api/leader/me/create-member-profile').set('X-CSRF-Token', csrf).send({ whatsapp: '+237670300002', password: 'Testpass123' });
    expect(res.status).toBe(201);
    expect(res.body.personName).toBe('Fresh Bridge Leader');

    const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updatedUser?.personId).toBe(res.body.personId);

    const person = await prisma.person.findUnique({ where: { id: res.body.personId }, include: { memberAccount: true } });
    expect(person?.whatsappNumber).toBe('+237670300002');
    expect(person?.memberAccount?.email).toBe('fresh-bridge@test.local');
    expect(person?.memberAccount?.passwordHash).toBeTruthy();

    // The same agent is now ALSO signed in as a Member (msid cookie),
    // without affecting its existing Leader (sid) session.
    const memberMe = await agent.get('/api/member/auth/me');
    expect(memberMe.body.member?.personId).toBe(res.body.personId);
    const leaderMe = await agent.get('/api/auth/me');
    expect(leaderMe.body.user?.role).toBe('LEADER');
    expect(leaderMe.body.user?.personId).toBe(res.body.personId);

    // The real point of this: after logging out, the Leader can sign back
    // in directly on the Member side with the password they just chose —
    // no more falling back to the Leader dashboard to get back in.
    const freshAgent = agentWithUniqueIp();
    const { csrf: memberCsrf } = await bootstrap(freshAgent as any);
    const memberLogin = await freshAgent
      .post('/api/member/auth/login')
      .set('X-CSRF-Token', memberCsrf)
      .send({ email: 'fresh-bridge@test.local', password: 'Testpass123' });
    expect(memberLogin.status).toBe(200);
  });

  it('is one-time: a second attempt is rejected once already linked', async () => {
    await createLeader('Twice Bridge Leader', 'twice-bridge@test.local', 'TWICEC01');
    const { agent, csrf } = await loginAsLeader('twice-bridge@test.local');
    await agent.post('/api/leader/me/create-member-profile').set('X-CSRF-Token', csrf).send({ whatsapp: '+237670300003', password: 'Testpass123' });

    const second = await agent.post('/api/leader/me/create-member-profile').set('X-CSRF-Token', csrf).send({ whatsapp: '+237670300004', password: 'Testpass123' });
    expect(second.status).toBe(409);
  });

  it('connects to an existing Person (same phone, no MemberAccount yet) instead of creating a duplicate', async () => {
    const existing = await prisma.person.create({ data: { name: 'Old Registrant', whatsappNumber: '+237670300005' } });
    await createLeader('Connect Bridge Leader', 'connect-bridge@test.local', 'CONNECTC1');
    const { agent, csrf } = await loginAsLeader('connect-bridge@test.local');

    const res = await agent.post('/api/leader/me/create-member-profile').set('X-CSRF-Token', csrf).send({ whatsapp: '+237670300005', password: 'Testpass123' });
    expect(res.status).toBe(201);
    expect(res.body.personId).toBe(existing.id);

    const account = await prisma.memberAccount.findUnique({ where: { personId: existing.id } });
    expect(account?.email).toBe('connect-bridge@test.local');
    expect(account?.passwordHash).toBeTruthy();
  });

  it('backfills a password onto a reused Person whose existing MemberAccount had none, without touching one that already has a password', async () => {
    const noPassword = await prisma.person.create({ data: { name: 'No Password Yet', whatsappNumber: '+237670300011' } });
    await prisma.memberAccount.create({ data: { personId: noPassword.id, email: 'connect-nopass@test.local' } });
    await createLeader('Backfill Bridge Leader', 'connect-nopass@test.local', 'BACKFILLC1');
    const { agent, csrf } = await loginAsLeader('connect-nopass@test.local');

    const res = await agent.post('/api/leader/me/create-member-profile').set('X-CSRF-Token', csrf).send({ whatsapp: '+237670300011', password: 'Testpass123' });
    expect(res.status).toBe(201);
    const account = await prisma.memberAccount.findUnique({ where: { personId: noPassword.id } });
    expect(account?.passwordHash).toBeTruthy();

    const hasPassword = await prisma.person.create({ data: { name: 'Has Password Already', whatsappNumber: '+237670300012' } });
    const existingAccount = await prisma.memberAccount.create({
      data: { personId: hasPassword.id, email: 'connect-haspass@test.local', passwordHash: 'already-set-hash' },
    });
    await createLeader('Keep Password Bridge Leader', 'connect-haspass@test.local', 'KEEPC01');
    const { agent: agent2, csrf: csrf2 } = await loginAsLeader('connect-haspass@test.local');
    await agent2.post('/api/leader/me/create-member-profile').set('X-CSRF-Token', csrf2).send({ whatsapp: '+237670300012', password: 'Testpass123' });
    const unchanged = await prisma.memberAccount.findUnique({ where: { id: existingAccount.id } });
    expect(unchanged?.passwordHash).toBe('already-set-hash');
  });

  it('rejects when the phone already belongs to a different member account', async () => {
    const other = await prisma.person.create({ data: { name: 'Someone Else', whatsappNumber: '+237670300006' } });
    await prisma.memberAccount.create({ data: { personId: other.id, email: 'someone-else@example.com' } });
    await createLeader('Conflict Bridge Leader', 'conflict-bridge@test.local', 'CONFLICTC1');
    const { agent, csrf } = await loginAsLeader('conflict-bridge@test.local');

    const res = await agent.post('/api/leader/me/create-member-profile').set('X-CSRF-Token', csrf).send({ whatsapp: '+237670300006', password: 'Testpass123' });
    expect(res.status).toBe(409);
    const stillUnlinked = await prisma.user.findFirst({ where: { email: 'conflict-bridge@test.local' } });
    expect(stillUnlinked?.personId).toBeNull();
  });

  it("rejects when a different Person's member account already uses the Leader's own email", async () => {
    const other = await prisma.person.create({ data: { name: 'Email Squatter', whatsappNumber: '+237670300007' } });
    await prisma.memberAccount.create({ data: { personId: other.id, email: 'email-bridge@test.local' } });
    await createLeader('Email Conflict Leader', 'email-bridge@test.local', 'EMAILC01');
    const { agent, csrf } = await loginAsLeader('email-bridge@test.local');

    const res = await agent.post('/api/leader/me/create-member-profile').set('X-CSRF-Token', csrf).send({ whatsapp: '+237670300008', password: 'Testpass123' });
    expect(res.status).toBe(409);
    expect(await prisma.person.findUnique({ where: { whatsappNumber: '+237670300008' } })).toBeNull();
  });

  it('records an audit entry for the self-link', async () => {
    await createLeader('Audit Bridge Leader', 'audit-bridge@test.local', 'AUDITC01');
    const { agent, csrf } = await loginAsLeader('audit-bridge@test.local');
    await agent.post('/api/leader/me/create-member-profile').set('X-CSRF-Token', csrf).send({ whatsapp: '+237670300009', password: 'Testpass123' });

    const entry = await prisma.auditLog.findFirst({ where: { action: 'LEADER_SELF_LINKED_MEMBER_PROFILE', actorEmail: 'audit-bridge@test.local' } });
    expect(entry).not.toBeNull();
  });
});

describe('GET /api/leader/dashboard reports memberProfileHasPassword', () => {
  it('is null when not linked, false when linked with no password, true once set', async () => {
    await createLeader('Dashboard Flag Leader', 'dashflag-bridge@test.local', 'DASHFLAGC1');
    const { agent, csrf } = await loginAsLeader('dashflag-bridge@test.local');

    const before = await agent.get('/api/leader/dashboard');
    expect(before.body.memberProfileHasPassword).toBeNull();

    await agent.post('/api/leader/me/create-member-profile').set('X-CSRF-Token', csrf).send({ whatsapp: '+237670300016', password: 'Testpass123' });
    const after = await agent.get('/api/leader/dashboard');
    expect(after.body.memberProfileHasPassword).toBe(true);
  });

  it('is false for a legacy linked account with no password yet', async () => {
    const legacyPerson = await prisma.person.create({ data: { name: 'Legacy Dash Person', whatsappNumber: '+237670300017', email: 'legacy-dashflag@test.local' } });
    await prisma.memberAccount.create({ data: { personId: legacyPerson.id, email: 'legacy-dashflag@test.local' } });
    const { user } = await createLeader('Legacy Dash Leader', 'legacy-dashflag@test.local', 'LEGDASHC1');
    await prisma.user.update({ where: { id: user.id }, data: { personId: legacyPerson.id } });

    const { agent } = await loginAsLeader('legacy-dashflag@test.local');
    const res = await agent.get('/api/leader/dashboard');
    expect(res.body.memberProfileHasPassword).toBe(false);
  });
});

describe('Leader sets a password on an already-linked Member profile with none (legacy backfill)', () => {
  it('requires authentication and CSRF', async () => {
    const anon = agentWithUniqueIp();
    expect((await anon.post('/api/leader/me/set-member-password').send({ password: 'Testpass123' })).status).toBe(401);
  });

  it('rejects a Leader who is not linked to a Member profile yet', async () => {
    await createLeader('Unlinked Leader', 'unlinked-setpass@test.local', 'UNLINKEDC1');
    const { agent, csrf } = await loginAsLeader('unlinked-setpass@test.local');
    const res = await agent.post('/api/leader/me/set-member-password').set('X-CSRF-Token', csrf).send({ password: 'Testpass123' });
    expect(res.status).toBe(400);
  });

  it('rejects a password under 8 characters', async () => {
    await createLeader('Legacy Short Pass Leader', 'legacy-shortpass@test.local', 'LEGSHORTC1');
    const { agent, csrf } = await loginAsLeader('legacy-shortpass@test.local');
    await agent.post('/api/leader/me/create-member-profile').set('X-CSRF-Token', csrf).send({ whatsapp: '+237670300013', password: 'Testpass123' });
    const res = await agent.post('/api/leader/me/set-member-password').set('X-CSRF-Token', csrf).send({ password: 'short' });
    expect(res.status).toBe(400);
  });

  it('sets a password on a legacy linked account that has none, letting the Leader sign in directly afterward', async () => {
    const legacyPerson = await prisma.person.create({ data: { name: 'Legacy Leader Person', whatsappNumber: '+237670300014', email: 'legacy-nopass@test.local' } });
    await prisma.memberAccount.create({ data: { personId: legacyPerson.id, email: 'legacy-nopass@test.local' } });
    const { user } = await createLeader('Legacy Leader', 'legacy-nopass@test.local', 'LEGNOPASSC1');
    await prisma.user.update({ where: { id: user.id }, data: { personId: legacyPerson.id } });

    const { agent, csrf } = await loginAsLeader('legacy-nopass@test.local');
    const res = await agent.post('/api/leader/me/set-member-password').set('X-CSRF-Token', csrf).send({ password: 'Newpass123' });
    expect(res.status).toBe(200);

    const account = await prisma.memberAccount.findUnique({ where: { personId: legacyPerson.id } });
    expect(account?.passwordHash).toBeTruthy();

    const freshAgent = agentWithUniqueIp();
    const { csrf: memberCsrf } = await bootstrap(freshAgent as any);
    const memberLogin = await freshAgent
      .post('/api/member/auth/login')
      .set('X-CSRF-Token', memberCsrf)
      .send({ email: 'legacy-nopass@test.local', password: 'Newpass123' });
    expect(memberLogin.status).toBe(200);
  });

  it('refuses to overwrite a password that is already set', async () => {
    await createLeader('Already Set Leader', 'already-set@test.local', 'ALREADYC1');
    const { agent, csrf } = await loginAsLeader('already-set@test.local');
    await agent.post('/api/leader/me/create-member-profile').set('X-CSRF-Token', csrf).send({ whatsapp: '+237670300015', password: 'Testpass123' });

    const res = await agent.post('/api/leader/me/set-member-password').set('X-CSRF-Token', csrf).send({ password: 'Anotherpass123' });
    expect(res.status).toBe(409);
  });
});
