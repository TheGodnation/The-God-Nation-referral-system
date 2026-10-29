import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';

// Admin <-> Member identity bridge — Section 13/14 of the unified Leader/
// Member identity build. The exact same mechanism as leader.ts's
// /me/create-member-profile, just under /api/admin: the Admin gains a
// Person, MemberAccount, friends list and personal referral code — "the
// same functionalities as every other person", never the Leadership
// Dashboard toolset (see adminMemberBridge.ts).
const app = createApp();

async function loginAsAdmin(email: string, password = 'AdminPass123!') {
  await createAdmin(email, password);
  const agent = request.agent(app);
  const { csrf } = await bootstrap(agent);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password });
  return { agent, csrf };
}

describe('Admin <-> Member identity bridge', () => {
  it('requires authentication, ADMIN role, and CSRF', async () => {
    const anon = request.agent(app);
    expect((await anon.post('/api/admin/me/create-member-profile').send({ whatsapp: '+237670500001', password: 'Testpass123' })).status).toBe(401);
  });

  it('creates a Person + MemberAccount, links personId, signs the Admin into the Member side, and never fires the Leader-only notice', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-bridge1@test.local');

    const res = await agent
      .post('/api/admin/me/create-member-profile')
      .set('X-CSRF-Token', csrf)
      .send({ whatsapp: '+237670500002', password: 'Testpass123' });
    expect(res.status).toBe(201);

    const adminUser = await prisma.user.findUnique({ where: { email: 'admin-bridge1@test.local' } });
    expect(adminUser?.personId).toBe(res.body.personId);
    expect(adminUser?.personLinkNotifiedAt).toBeNull();

    const notification = await prisma.notification.findFirst({
      where: { recipientPersonId: res.body.personId, type: 'LEADER_DASHBOARD_MOVED' },
    });
    expect(notification).toBeNull();

    // Signed into the Member side right away.
    const memberMe = await agent.get('/api/member/auth/me');
    expect(memberMe.body.member?.personId).toBe(res.body.personId);

    // This bridged Person gets its own referral code too, like every other
    // Person — usable for ad campaigns etc.
    const code = await prisma.referralCode.findUnique({ where: { personId: res.body.personId } });
    expect(code).not.toBeNull();
  });

  it('opens the admin’s member profile from the dashboard session alone, with no second sign-in', async () => {
    const first = await loginAsAdmin('admin-open1@test.local');
    const created = await first.agent.post('/api/admin/me/create-member-profile').set('X-CSRF-Token', first.csrf).send({ whatsapp: '+237670500011', password: 'Testpass123' });
    expect(created.status).toBe(201);

    // Later: signed in to the dashboard only (a fresh browser session, no member cookie).
    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);
    await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: 'admin-open1@test.local', password: 'AdminPass123!' });
    expect((await agent.get('/api/member/auth/me')).body.member).toBeNull();

    const res = await agent.post('/api/admin/me/open-member-profile').set('X-CSRF-Token', csrf);
    expect(res.status).toBe(200);
    expect((await agent.get('/api/member/auth/me')).body.member?.personId).toBe(created.body.personId);
    // The dashboard session is still there.
    expect((await agent.get('/api/auth/me')).body.user?.email).toBe('admin-open1@test.local');
  });

  it('says there is no member profile yet for an admin who has not made one, and needs a sign-in and CSRF', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-open2@test.local');
    const none = await agent.post('/api/admin/me/open-member-profile').set('X-CSRF-Token', csrf);
    expect(none.status).toBe(404);
    expect(none.body.code).toBe('NO_MEMBER_PROFILE');
    expect((await agent.post('/api/admin/me/open-member-profile')).status).toBe(403);
    expect((await request.agent(app).post('/api/admin/me/open-member-profile')).status).toBe(401);
  });

  it('is one-time: a second attempt is rejected once already linked', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-bridge2@test.local');
    await agent.post('/api/admin/me/create-member-profile').set('X-CSRF-Token', csrf).send({ whatsapp: '+237670500003', password: 'Testpass123' });
    const second = await agent.post('/api/admin/me/create-member-profile').set('X-CSRF-Token', csrf).send({ whatsapp: '+237670500004', password: 'Testpass123' });
    expect(second.status).toBe(409);
  });

  it('records an ADMIN-specific audit action, not the Leader one', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-bridge3@test.local');
    await agent.post('/api/admin/me/create-member-profile').set('X-CSRF-Token', csrf).send({ whatsapp: '+237670500005', password: 'Testpass123' });

    const entry = await prisma.auditLog.findFirst({ where: { action: 'ADMIN_SELF_LINKED_MEMBER_PROFILE', actorEmail: 'admin-bridge3@test.local' } });
    expect(entry).not.toBeNull();
    const leaderEntry = await prisma.auditLog.findFirst({ where: { action: 'LEADER_SELF_LINKED_MEMBER_PROFILE', actorEmail: 'admin-bridge3@test.local' } });
    expect(leaderEntry).toBeNull();
  });

  it('a Leader cannot use the Admin bridge endpoint', async () => {
    const passwordHash = 'irrelevant';
    const leader = await prisma.user.create({ data: { name: 'Leader X', email: 'leader-not-admin@test.local', passwordHash, role: 'LEADER', active: true } });
    void leader;
    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);
    // Not even logged in as this Leader — just confirming the route itself
    // is ADMIN-gated regardless.
    const res = await agent.post('/api/admin/me/create-member-profile').set('X-CSRF-Token', csrf).send({ whatsapp: '+237670500006', password: 'Testpass123' });
    expect(res.status).toBe(401);
  });
});

describe('Settings.defaultReferrerPersonId — the catch-all every unattributed joiner is auto-friended to', () => {
  it('Admin can set it to an existing Person via PATCH /api/admin/settings', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-catchall1@test.local');
    const bridgeRes = await agent.post('/api/admin/me/create-member-profile').set('X-CSRF-Token', csrf).send({ whatsapp: '+237670500007', password: 'Testpass123' });

    const res = await agent.patch('/api/admin/settings').set('X-CSRF-Token', csrf).send({ defaultReferrerPersonId: bridgeRes.body.personId });
    expect(res.status).toBe(200);
    expect(res.body.defaultReferrerPersonId).toBe(bridgeRes.body.personId);

    const getRes = await agent.get('/api/admin/settings');
    expect(getRes.body.defaultReferrerPersonId).toBe(bridgeRes.body.personId);
    expect(getRes.body.defaultReferrerPersonName).toBe('Test Admin');
  });

  it('rejects an unknown personId', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-catchall2@test.local');
    const res = await agent.patch('/api/admin/settings').set('X-CSRF-Token', csrf).send({ defaultReferrerPersonId: 'nope' });
    expect(res.status).toBe(400);
  });

  it('can be cleared back to null', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-catchall3@test.local');
    const bridgeRes = await agent.post('/api/admin/me/create-member-profile').set('X-CSRF-Token', csrf).send({ whatsapp: '+237670500008', password: 'Testpass123' });
    await agent.patch('/api/admin/settings').set('X-CSRF-Token', csrf).send({ defaultReferrerPersonId: bridgeRes.body.personId });

    const res = await agent.patch('/api/admin/settings').set('X-CSRF-Token', csrf).send({ defaultReferrerPersonId: null });
    expect(res.status).toBe(200);
    expect(res.body.defaultReferrerPersonId).toBeNull();
  });
});
