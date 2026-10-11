import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { createLeader, createAdmin } from './helpers';
import { bootstrap } from './testUtils';

const app = createApp();

// Each test here logs in as either a member or an Admin/Leader (often
// both) — enough distinct auth round trips per file to exhaust the shared
// per-IP loginLimiter/memberLoginRequestLimiter budgets if every test
// shared one source IP (see the Phase 3B attemptScoring.test.ts precedent
// for this exact issue). Each login gets its own simulated IP.
let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.72.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
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

async function loginAsMember(whatsapp: string, email: string, name = 'Member Person') {
  await prisma.person.create({ data: { name, whatsappNumber: whatsapp } });
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });

  const requestAgent = agentWithUniqueIp();
  const { csrf: requestCsrf } = await bootstrap(requestAgent as any);
  await requestAgent.post('/api/member/auth/request-link').set('X-CSRF-Token', requestCsrf).send({ whatsapp, email });
  const link = spy.mock.calls[0][0].link as string;
  spy.mockRestore();

  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  const res = await agent.post('/api/member/auth/consume').set('X-CSRF-Token', csrf).send({ token: extractToken(link) });
  return { agent, csrf, res };
}

async function loginAsAdmin(email = 'admin-member-iso@test.local', password = 'AdminPass123!') {
  await createAdmin(email, password);
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password });
  return { agent, csrf };
}

describe('Phase 3C — Member session lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a working MemberSession on successful magic-link consumption', async () => {
    const { agent, res } = await loginAsMember('+237670009001', 'session1@example.com', 'Session One');
    expect(res.status).toBe(200);
    expect(res.body.member.email).toBe('session1@example.com');

    const me = await agent.get('/api/member/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.member.name).toBe('Session One');
  });

  it('logs out and invalidates the MemberSession', async () => {
    const { agent, csrf } = await loginAsMember('+237670009002', 'session2@example.com');

    const logout = await agent.post('/api/member/auth/logout').set('X-CSRF-Token', csrf);
    expect(logout.status).toBe(200);

    const me = await agent.get('/api/member/auth/me');
    expect(me.body.member).toBeNull();

    const devotionals = await agent.get('/api/member/devotionals');
    expect(devotionals.status).toBe(401);
  });

  it('rejects an expired MemberSession', async () => {
    const { agent } = await loginAsMember('+237670009003', 'session3@example.com');
    await prisma.memberSession.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    const me = await agent.get('/api/member/auth/me');
    expect(me.body.member).toBeNull();

    const devotionals = await agent.get('/api/member/devotionals');
    expect(devotionals.status).toBe(401);
  });
});

describe('Phase 3C — Member/Admin/Leader session isolation (critical boundary)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never lets a MemberSession authorize any /api/admin/* route', async () => {
    const { agent, csrf } = await loginAsMember('+237670009004', 'boundary1@example.com');

    const list = await agent.get('/api/admin/people');
    expect(list.status).toBe(401);
    const create = await agent
      .post('/api/admin/people')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Nope', whatsappNumber: '+237670009999' });
    expect(create.status).toBe(401);
    const dashboard = await agent.get('/api/admin/dashboard');
    expect(dashboard.status).toBe(401);
  });

  it('never lets a MemberSession authorize any /api/leader/* route', async () => {
    const { agent } = await loginAsMember('+237670009005', 'boundary2@example.com');
    const dashboard = await agent.get('/api/leader/dashboard');
    expect(dashboard.status).toBe(401);
  });

  it('never lets an Admin session authorize member-only routes', async () => {
    const { agent } = await loginAsAdmin();
    const devotionals = await agent.get('/api/member/devotionals');
    expect(devotionals.status).toBe(401);
  });

  it('never lets a Leader session authorize member-only routes', async () => {
    await createLeader('Iso Leader', 'iso-leader@example.com', 'ISOLD1');
    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: 'iso-leader@example.com', password: 'password123' });

    const devotionals = await agent.get('/api/member/devotionals');
    expect(devotionals.status).toBe(401);
  });

  it('never lets an Admin/Leader session be interpreted as a member session, and vice versa', async () => {
    const { agent: adminAgent } = await loginAsAdmin('admin-cross-check@test.local');
    const adminMe = await adminAgent.get('/api/member/auth/me');
    // The admin's own 'sid' session cookie is present, but /api/member/auth/me
    // only ever reads 'msid' — an Admin session must never be reported as an
    // authenticated member.
    expect(adminMe.body.member).toBeNull();

    const { agent: memberAgent } = await loginAsMember('+237670009006', 'crosscheck@example.com');
    const memberAdminMe = await memberAgent.get('/api/auth/me');
    // Symmetric check: a member session must never be reported as an
    // authenticated Admin/Leader user either.
    expect(memberAdminMe.body.user).toBeNull();
  });

  it('does not affect an Admin session when a member logs out, or vice versa', async () => {
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-no-cross-logout@test.local');
    const { agent: memberAgent, csrf: memberCsrf } = await loginAsMember('+237670009007', 'nocrosslogout@example.com');

    await memberAgent.post('/api/member/auth/logout').set('X-CSRF-Token', memberCsrf);

    // The Admin's own session is completely unaffected.
    const adminMe = await adminAgent.get('/api/auth/me');
    expect(adminMe.body.user).not.toBeNull();

    await adminAgent.post('/api/auth/logout').set('X-CSRF-Token', adminCsrf);
    // Logging out the Admin must not touch the member's own (already
    // logged-out) session state either — no shared mutation path exists.
    const memberMeAfter = await memberAgent.get('/api/member/auth/me');
    expect(memberMeAfter.body.member).toBeNull();
  });
});
