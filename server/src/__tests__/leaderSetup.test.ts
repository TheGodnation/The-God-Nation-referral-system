import crypto from 'crypto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';
import { hashToken } from '../lib/auth';
import * as emailModule from '../lib/email';

const app = createApp();

function sha256(raw: string) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

async function loginAsAdmin() {
  await createAdmin('admin-setup@test.local', 'AdminPass123!');
  const agent = request.agent(app);
  const { csrf } = await bootstrap(agent);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: 'admin-setup@test.local', password: 'AdminPass123!' });
  return { agent, csrf };
}

describe('New Leader onboarding via secure setup token', () => {
  afterEach(() => vi.restoreAllMocks());

  it('creating a Leader never returns a password, and issues a setup email instead', async () => {
    const spy = vi.spyOn(emailModule.EmailService, 'sendLeaderInvitation').mockResolvedValue({ ok: true });
    const { agent, csrf } = await loginAsAdmin();

    const res = await agent
      .post('/api/admin/leaders')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'New Leader', email: 'newleader@example.com', referralCode: 'NEWL1234' });

    expect(res.status).toBe(201);
    expect(res.body.temporaryPassword).toBeUndefined();
    expect(res.body.invitationSent).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    const setupUrl: string = spy.mock.calls[0][0].setupUrl;
    expect(setupUrl).toContain('/leader/setup?token=');

    // The raw token appears only in the (mocked) email call — never in the DB.
    const rawToken = new URL(setupUrl).searchParams.get('token')!;
    const stored = await prisma.leaderSetupToken.findUnique({ where: { tokenHash: sha256(rawToken) } });
    expect(stored).toBeTruthy();
    expect(stored!.consumedAt).toBeNull();
  });

  it('completes setup, logs the Leader in, and the token cannot be reused', async () => {
    vi.spyOn(emailModule.EmailService, 'sendLeaderInvitation').mockResolvedValue({ ok: true });
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin();

    const createRes = await adminAgent
      .post('/api/admin/leaders')
      .set('X-CSRF-Token', adminCsrf)
      .send({ name: 'Setup Leader', email: 'setupflow@example.com', referralCode: 'SETUP123' });

    const setupUrl: string = (emailModule.EmailService.sendLeaderInvitation as any).mock.calls[0][0].setupUrl;
    const rawToken = new URL(setupUrl).searchParams.get('token')!;

    const leaderAgent = request.agent(app);
    const { csrf: leaderCsrf } = await bootstrap(leaderAgent);
    const setupRes = await leaderAgent
      .post('/api/auth/leader-setup/complete')
      .set('X-CSRF-Token', leaderCsrf)
      .send({ token: rawToken, newPassword: 'BrandNewLeaderPass1!' });

    expect(setupRes.status).toBe(200);
    expect(setupRes.body.user.email).toBe('setupflow@example.com');

    // Normal login now works with the chosen password.
    const freshAgent = request.agent(app);
    const { csrf: freshCsrf } = await bootstrap(freshAgent);
    const loginRes = await freshAgent
      .post('/api/auth/login')
      .set('X-CSRF-Token', freshCsrf)
      .send({ email: 'setupflow@example.com', password: 'BrandNewLeaderPass1!' });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user.mustChangePassword).toBe(false);

    // Reusing the same (now-consumed) token fails.
    const reuseAgent = request.agent(app);
    const { csrf: reuseCsrf } = await bootstrap(reuseAgent);
    const reuseRes = await reuseAgent
      .post('/api/auth/leader-setup/complete')
      .set('X-CSRF-Token', reuseCsrf)
      .send({ token: rawToken, newPassword: 'AnotherPass123!' });
    expect(reuseRes.status).toBe(400);

    void createRes;
  });

  it('rejects an unknown token and an expired token', async () => {
    const admin = await createAdmin('admin-expiry@test.local', 'AdminPass123!');
    void admin;

    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);

    const unknownRes = await agent
      .post('/api/auth/leader-setup/complete')
      .set('X-CSRF-Token', csrf)
      .send({ token: 'totally-made-up-token', newPassword: 'SomePass123!' });
    expect(unknownRes.status).toBe(400);

    // Directly create an already-expired token to test that path.
    const leader = await prisma.user.create({
      data: {
        name: 'Expired Leader',
        email: 'expired-leader@example.com',
        passwordHash: 'unusable',
        role: 'LEADER',
      },
    });
    const rawToken = crypto.randomBytes(32).toString('hex');
    await prisma.leaderSetupToken.create({
      data: {
        leaderId: leader.id,
        tokenHash: sha256(rawToken),
        expiresAt: new Date(Date.now() - 1000), // already expired
      },
    });

    const expiredRes = await agent
      .post('/api/auth/leader-setup/complete')
      .set('X-CSRF-Token', csrf)
      .send({ token: rawToken, newPassword: 'SomePass123!' });
    expect(expiredRes.status).toBe(400);
  });

  it('Admin resend-invitation invalidates the prior token and issues a new one', async () => {
    const spy = vi.spyOn(emailModule.EmailService, 'sendLeaderInvitation').mockResolvedValue({ ok: true });
    const { agent, csrf } = await loginAsAdmin();

    const createRes = await agent
      .post('/api/admin/leaders')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Resend Leader', email: 'resend@example.com', referralCode: 'RESEND12' });
    const leaderId = createRes.body.id;
    const firstRawToken = new URL(spy.mock.calls[0][0].setupUrl).searchParams.get('token')!;

    const resendRes = await agent
      .post(`/api/admin/leaders/${leaderId}/resend-invitation`)
      .set('X-CSRF-Token', csrf)
      .send({});
    expect(resendRes.status).toBe(200);
    expect(resendRes.body.invitationSent).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);

    // The first token is now invalid.
    const staleAgent = request.agent(app);
    const { csrf: staleCsrf } = await bootstrap(staleAgent);
    const staleRes = await staleAgent
      .post('/api/auth/leader-setup/complete')
      .set('X-CSRF-Token', staleCsrf)
      .send({ token: firstRawToken, newPassword: 'SomePass123!' });
    expect(staleRes.status).toBe(400);

    // The new token works.
    const secondRawToken = new URL(spy.mock.calls[1][0].setupUrl).searchParams.get('token')!;
    const goodAgent = request.agent(app);
    const { csrf: goodCsrf } = await bootstrap(goodAgent);
    const goodRes = await goodAgent
      .post('/api/auth/leader-setup/complete')
      .set('X-CSRF-Token', goodCsrf)
      .send({ token: secondRawToken, newPassword: 'SomePass123!' });
    expect(goodRes.status).toBe(200);
  });

  it('a failed invitation email leaves the Leader recoverable via resend', async () => {
    vi.spyOn(emailModule.EmailService, 'sendLeaderInvitation').mockResolvedValue({ ok: false });
    const { agent, csrf } = await loginAsAdmin();

    const createRes = await agent
      .post('/api/admin/leaders')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Bounce Leader', email: 'bounce@example.com', referralCode: 'BOUNCE12' });
    expect(createRes.status).toBe(201);
    expect(createRes.body.invitationSent).toBe(false); // send failed, but Leader still exists

    vi.spyOn(emailModule.EmailService, 'sendLeaderInvitation').mockResolvedValue({ ok: true });
    const resendRes = await agent
      .post(`/api/admin/leaders/${createRes.body.id}/resend-invitation`)
      .set('X-CSRF-Token', csrf)
      .send({});
    expect(resendRes.status).toBe(200);
    expect(resendRes.body.invitationSent).toBe(true);
  });
});
