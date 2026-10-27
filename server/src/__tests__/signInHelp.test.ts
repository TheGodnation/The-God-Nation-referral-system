import { describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createAdmin, createLeader } from './helpers';
import { bootstrap } from './testUtils';

// "Help them sign in" — the central admin makes a one-time, 24-hour link for
// someone who forgot their password and can't get the emailed codes; they
// open it and choose a new password themselves.
const app = createApp();

let n = 0;
async function loginAsAdmin() {
  n += 1;
  const email = `help-admin${n}@test.local`;
  const admin = await createAdmin(email, 'AdminPass123!');
  const agent = request.agent(app);
  const { csrf } = await bootstrap(agent);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'AdminPass123!' });
  return { agent, csrf, admin };
}

async function member() {
  n += 1;
  const person = await prisma.person.create({
    data: { name: `Forgetful ${n}`, whatsappNumber: `+2376709${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() },
  });
  const account = await prisma.memberAccount.create({
    data: { personId: person.id, email: `forgot${n}@example.com`, passwordHash: await bcrypt.hash('OldPassword1', 10) },
  });
  return { person, account };
}

const tokenOf = (url: string) => new URL(url).searchParams.get('token')!;

describe('Help them sign in', () => {
  it('gives the admin a one-time link; the member chooses a new password and is signed in', async () => {
    const { agent, csrf } = await loginAsAdmin();
    const { person, account } = await member();

    // A phone that was still signed in to the account.
    await prisma.memberSession.create({ data: { memberAccountId: account.id, tokenHash: 'old-session', expiresAt: new Date(Date.now() + 86_400_000) } });

    const made = await agent.post(`/api/admin/people/${person.id}/sign-in-help`).set('X-CSRF-Token', csrf).send({});
    expect(made.status).toBe(200);
    expect(made.body.kind).toBe('MEMBER');
    expect(made.body.url).toContain('/member/password-help?token=');
    expect(made.body.whatsappNumber).toBe(person.whatsappNumber);
    const hours = (new Date(made.body.expiresAt).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThanOrEqual(24);

    const token = tokenOf(made.body.url);
    const memberAgent = request.agent(app);
    const { csrf: mcsrf } = await bootstrap(memberAgent);

    const info = await memberAgent.get(`/api/member/auth/password-help?token=${token}`);
    expect(info.status).toBe(200);
    expect(info.body.name).toBe(person.name);

    const tooShort = await memberAgent.post('/api/member/auth/password-help').set('X-CSRF-Token', mcsrf).send({ token, newPassword: 'short' });
    expect(tooShort.status).toBe(400);
    expect(tooShort.body.code).toBe('INVALID_PASSWORD');

    const done = await memberAgent.post('/api/member/auth/password-help').set('X-CSRF-Token', mcsrf).send({ token, newPassword: 'BrandNewPass1' });
    expect(done.status).toBe(200);
    expect(done.body.member.email).toBe(account.email);
    expect((await memberAgent.get('/api/member/auth/me')).body.member.email).toBe(account.email);

    // The new password works, the old one doesn't, the other phone is signed out.
    const updated = await prisma.memberAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(await bcrypt.compare('BrandNewPass1', updated.passwordHash!)).toBe(true);
    expect(await prisma.memberSession.count({ where: { tokenHash: 'old-session' } })).toBe(0);

    // Once only.
    const again = await request.agent(app).get(`/api/member/auth/password-help?token=${token}`);
    expect(again.status).toBe(400);
    expect(again.body.code).toBe('BAD_LINK');
    const reuse = await memberAgent.post('/api/member/auth/password-help').set('X-CSRF-Token', mcsrf).send({ token, newPassword: 'AnotherPass1' });
    expect(reuse.status).toBe(400);

    const audit = await prisma.auditLog.findFirst({ where: { action: 'SIGN_IN_HELP_LINK_CREATED', targetId: person.id } });
    expect(audit).not.toBeNull();
  });

  it('an earlier link still works after a new one is made; once one is used, the others stop; expired links never work', async () => {
    const { agent, csrf } = await loginAsAdmin();
    const { person } = await member();
    const first = await agent.post(`/api/admin/people/${person.id}/sign-in-help`).set('X-CSRF-Token', csrf).send({});
    const second = await agent.post(`/api/admin/people/${person.id}/sign-in-help`).set('X-CSRF-Token', csrf).send({});
    const third = await agent.post(`/api/admin/people/${person.id}/sign-in-help`).set('X-CSRF-Token', csrf).send({});
    expect((await request(app).get(`/api/member/auth/password-help?token=${tokenOf(first.body.url)}`)).status).toBe(200);
    expect((await request(app).get(`/api/member/auth/password-help?token=${tokenOf(second.body.url)}`)).status).toBe(200);

    const memberAgent = request.agent(app);
    const { csrf: mcsrf } = await bootstrap(memberAgent);
    expect((await memberAgent.post('/api/member/auth/password-help').set('X-CSRF-Token', mcsrf).send({ token: tokenOf(first.body.url), newPassword: 'FirstLink123' })).status).toBe(200);
    expect((await request(app).get(`/api/member/auth/password-help?token=${tokenOf(second.body.url)}`)).status).toBe(400);

    const fourth = await agent.post(`/api/admin/people/${person.id}/sign-in-help`).set('X-CSRF-Token', csrf).send({});
    await prisma.memberPasswordHelpLink.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await request(app).get(`/api/member/auth/password-help?token=${tokenOf(fourth.body.url)}`)).status).toBe(400);
    expect(third.status).toBe(200);
  });

  it('for a leader with no member sign-in, gives the leader page’s own new-password link', async () => {
    const { agent, csrf } = await loginAsAdmin();
    const { user } = await createLeader('Leader Only', 'leader-only@test.local', 'LEADONLY1');
    const person = await prisma.person.create({ data: { name: 'Leader Only', whatsappNumber: '+237670999001' } });
    await prisma.user.update({ where: { id: user.id }, data: { personId: person.id } });

    const made = await agent.post(`/api/admin/people/${person.id}/sign-in-help`).set('X-CSRF-Token', csrf).send({});
    expect(made.status).toBe(200);
    expect(made.body.kind).toBe('LEADER');
    expect(made.body.url).toContain('/reset-password?token=');

    const leaderAgent = request.agent(app);
    const { csrf: lcsrf } = await bootstrap(leaderAgent);
    const reset = await leaderAgent.post('/api/auth/reset-password').set('X-CSRF-Token', lcsrf).send({ token: tokenOf(made.body.url), newPassword: 'LeaderNewPass1' });
    expect(reset.status).toBe(200);
    const login = await leaderAgent.post('/api/auth/login').set('X-CSRF-Token', lcsrf).send({ email: 'leader-only@test.local', password: 'LeaderNewPass1' });
    expect(login.status).toBe(200);
  });

  it('never for the central admin’s own profile', async () => {
    const { agent, csrf, admin } = await loginAsAdmin();
    const own = await prisma.person.create({ data: { name: 'The Admin', whatsappNumber: '+237670999002' } });
    await prisma.user.update({ where: { id: admin.id }, data: { personId: own.id } });
    await prisma.memberAccount.create({ data: { personId: own.id, email: 'admin-profile@example.com' } });

    const refused = await agent.post(`/api/admin/people/${own.id}/sign-in-help`).set('X-CSRF-Token', csrf).send({});
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('CENTRAL_ADMIN');

  });

  it('opens the account for someone who cannot open their email, then they choose a password and fill in their details', async () => {
    const { agent, csrf } = await loginAsAdmin();
    const nobody = await prisma.person.create({ data: { name: 'No Account', whatsappNumber: '+237670999003' } });
    const post = (body: object) => agent.post(`/api/admin/people/${nobody.id}/sign-in-help`).set('X-CSRF-Token', csrf).send(body);

    expect((await post({})).body.code).toBe('EMAIL_NEEDED');
    expect((await post({ email: 'not-an-email' })).body.code).toBe('EMAIL_NEEDED');
    await prisma.memberAccount.update({ where: { id: (await member()).account.id }, data: { email: 'taken@example.com' } });
    const taken = await post({ email: 'Taken@Example.com' });
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe('EMAIL_TAKEN');
    expect(await prisma.memberAccount.count({ where: { personId: nobody.id } })).toBe(0);

    const made = await post({ email: 'Brother.Paul@Example.com' });
    expect(made.status).toBe(200);
    expect(made.body.kind).toBe('MEMBER');
    const account = await prisma.memberAccount.findUniqueOrThrow({ where: { personId: nobody.id } });
    expect(account.email).toBe('brother.paul@example.com');
    expect(account.passwordHash).toBeNull();
    expect((await prisma.person.findUniqueOrThrow({ where: { id: nobody.id } })).email).toBe('brother.paul@example.com');
    expect(await prisma.auditLog.count({ where: { action: 'MEMBER_ACCOUNT_CREATED_BY_ADMIN', targetId: account.id } })).toBe(1);

    const token = tokenOf(made.body.url);
    const memberAgent = request.agent(app);
    const { csrf: mcsrf } = await bootstrap(memberAgent);
    const done = await memberAgent.post('/api/member/auth/password-help').set('X-CSRF-Token', mcsrf).send({ token, newPassword: 'BrandNewPass1' });
    expect(done.status).toBe(200);
    const me = await memberAgent.get('/api/member/auth/me');
    expect(me.body.member.email).toBe('brother.paul@example.com');
    expect(me.body.member.profileComplete).toBe(false); // sent on to fill in their details
  });

  it('from the Leaders list: a leader not linked to anyone in People gets the leader page’s link', async () => {
    const { agent, csrf } = await loginAsAdmin();
    const { user } = await createLeader('Unlinked Leader', 'unlinked@test.local', 'UNLINK1');

    const made = await agent.post(`/api/admin/leaders/${user.id}/sign-in-help`).set('X-CSRF-Token', csrf).send({});
    expect(made.status).toBe(200);
    expect(made.body.kind).toBe('LEADER');
    expect(made.body.whatsappNumber).toBeNull();
    expect(made.body.email).toBe('unlinked@test.local');

    const leaderAgent = request.agent(app);
    const { csrf: lcsrf } = await bootstrap(leaderAgent);
    expect((await leaderAgent.post('/api/auth/reset-password').set('X-CSRF-Token', lcsrf).send({ token: tokenOf(made.body.url), newPassword: 'UnlinkedNew1' })).status).toBe(200);
    expect((await leaderAgent.post('/api/auth/login').set('X-CSRF-Token', lcsrf).send({ email: 'unlinked@test.local', password: 'UnlinkedNew1' })).status).toBe(200);

    // Two links out: the earlier one still works; then the other stops.
    const first = await agent.post(`/api/admin/leaders/${user.id}/sign-in-help`).set('X-CSRF-Token', csrf).send({});
    const second = await agent.post(`/api/admin/leaders/${user.id}/sign-in-help`).set('X-CSRF-Token', csrf).send({});
    expect((await leaderAgent.post('/api/auth/reset-password').set('X-CSRF-Token', lcsrf).send({ token: tokenOf(first.body.url), newPassword: 'FirstLink123' })).status).toBe(200);
    expect((await leaderAgent.post('/api/auth/reset-password').set('X-CSRF-Token', lcsrf).send({ token: tokenOf(second.body.url), newPassword: 'Whatever123' })).status).toBe(400);
    expect((await leaderAgent.post('/api/auth/reset-password').set('X-CSRF-Token', lcsrf).send({ token: tokenOf(first.body.url), newPassword: 'Whatever123' })).status).toBe(400);
  });

  it('from the Leaders list: a leader with a member profile gets the app’s link; a turned-off leader gets none', async () => {
    const { agent, csrf } = await loginAsAdmin();
    const { person } = await member();
    const { user } = await createLeader('Linked Leader', 'linked@test.local', 'LINKED1');
    await prisma.user.update({ where: { id: user.id }, data: { personId: person.id } });

    const made = await agent.post(`/api/admin/leaders/${user.id}/sign-in-help`).set('X-CSRF-Token', csrf).send({});
    expect(made.status).toBe(200);
    expect(made.body.kind).toBe('MEMBER');
    expect(made.body.whatsappNumber).toBe(person.whatsappNumber);
    expect((await request(app).get(`/api/member/auth/password-help?token=${tokenOf(made.body.url)}`)).status).toBe(200);

    await prisma.user.update({ where: { id: user.id }, data: { active: false } });
    const off = await agent.post(`/api/admin/leaders/${user.id}/sign-in-help`).set('X-CSRF-Token', csrf).send({});
    expect(off.status).toBe(409);
    expect(off.body.code).toBe('INACTIVE');
  });

  it('only the central admin can make a link', async () => {
    const { person } = await member();
    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);
    const res = await agent.post(`/api/admin/people/${person.id}/sign-in-help`).set('X-CSRF-Token', csrf).send({});
    expect(res.status).toBe(401);
  });
});
