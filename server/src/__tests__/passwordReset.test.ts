import crypto from 'crypto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';
import * as emailModule from '../lib/email';

const app = createApp();

function sha256(raw: string) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

describe('Password reset (forgot-password / reset-password)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns the same generic response whether or not the account exists (no enumeration)', async () => {
    await createAdmin('exists@test.local', 'AdminPass123!');
    vi.spyOn(emailModule.EmailService, 'sendPasswordReset').mockResolvedValue({ ok: true });

    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);

    const resExists = await agent
      .post('/api/auth/forgot-password')
      .set('X-CSRF-Token', csrf)
      .send({ email: 'exists@test.local' });
    const resMissing = await agent
      .post('/api/auth/forgot-password')
      .set('X-CSRF-Token', csrf)
      .send({ email: 'does-not-exist@test.local' });

    expect(resExists.status).toBe(resMissing.status);
    expect(resExists.body).toEqual(resMissing.body);
  });

  it('only emails a reset link for an account that actually exists', async () => {
    await createAdmin('real-user@test.local', 'AdminPass123!');
    const spy = vi.spyOn(emailModule.EmailService, 'sendPasswordReset').mockResolvedValue({ ok: true });

    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);

    await agent.post('/api/auth/forgot-password').set('X-CSRF-Token', csrf).send({ email: 'real-user@test.local' });
    await agent.post('/api/auth/forgot-password').set('X-CSRF-Token', csrf).send({ email: 'nobody@test.local' });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].to).toBe('real-user@test.local');
    expect(spy.mock.calls[0][0].resetUrl).toContain('/reset-password?token=');
  });

  it('resets the password, invalidates all sessions, rejects the old password, accepts the new one', async () => {
    const admin = await createAdmin('reset-flow@test.local', 'OldPassword123!');
    const spy = vi.spyOn(emailModule.EmailService, 'sendPasswordReset').mockResolvedValue({ ok: true });

    // Establish an existing session before the reset.
    const sessionAgent = request.agent(app);
    const { csrf: sessionCsrf } = await bootstrap(sessionAgent);
    await sessionAgent
      .post('/api/auth/login')
      .set('X-CSRF-Token', sessionCsrf)
      .send({ email: 'reset-flow@test.local', password: 'OldPassword123!' });
    const sessionsBefore = await prisma.session.count({ where: { userId: admin.id } });
    expect(sessionsBefore).toBeGreaterThan(0);

    const requestAgent = request.agent(app);
    const { csrf: reqCsrf } = await bootstrap(requestAgent);
    await requestAgent
      .post('/api/auth/forgot-password')
      .set('X-CSRF-Token', reqCsrf)
      .send({ email: 'reset-flow@test.local' });

    const resetUrl: string = spy.mock.calls[0][0].resetUrl;
    const rawToken = new URL(resetUrl).searchParams.get('token')!;

    const resetRes = await requestAgent
      .post('/api/auth/reset-password')
      .set('X-CSRF-Token', reqCsrf)
      .send({ token: rawToken, newPassword: 'BrandNewPassword123!' });
    expect(resetRes.status).toBe(200);

    // All prior sessions for this user are gone.
    const sessionsAfter = await prisma.session.count({ where: { userId: admin.id } });
    expect(sessionsAfter).toBe(0);

    // Old password no longer works; new one does.
    const staleAgent = request.agent(app);
    const { csrf: staleCsrf } = await bootstrap(staleAgent);
    const staleLogin = await staleAgent
      .post('/api/auth/login')
      .set('X-CSRF-Token', staleCsrf)
      .send({ email: 'reset-flow@test.local', password: 'OldPassword123!' });
    expect(staleLogin.status).toBe(401);

    const freshAgent = request.agent(app);
    const { csrf: freshCsrf } = await bootstrap(freshAgent);
    const freshLogin = await freshAgent
      .post('/api/auth/login')
      .set('X-CSRF-Token', freshCsrf)
      .send({ email: 'reset-flow@test.local', password: 'BrandNewPassword123!' });
    expect(freshLogin.status).toBe(200);

    // Token cannot be reused.
    const reuseAgent = request.agent(app);
    const { csrf: reuseCsrf } = await bootstrap(reuseAgent);
    const reuseRes = await reuseAgent
      .post('/api/auth/reset-password')
      .set('X-CSRF-Token', reuseCsrf)
      .send({ token: rawToken, newPassword: 'YetAnotherPass123!' });
    expect(reuseRes.status).toBe(400);
  });

  it('rejects an unknown token and an expired token', async () => {
    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);

    const unknownRes = await agent
      .post('/api/auth/reset-password')
      .set('X-CSRF-Token', csrf)
      .send({ token: 'not-a-real-token', newPassword: 'SomePass123!' });
    expect(unknownRes.status).toBe(400);

    const user = await createAdmin('expiry-reset@test.local', 'AdminPass123!');
    const rawToken = crypto.randomBytes(32).toString('hex');
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: sha256(rawToken), expiresAt: new Date(Date.now() - 1000) },
    });

    const expiredRes = await agent
      .post('/api/auth/reset-password')
      .set('X-CSRF-Token', csrf)
      .send({ token: rawToken, newPassword: 'SomePass123!' });
    expect(expiredRes.status).toBe(400);
  });

  it('is rate limited', async () => {
    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);
    vi.spyOn(emailModule.EmailService, 'sendPasswordReset').mockResolvedValue({ ok: true });

    const results: number[] = [];
    for (let i = 0; i < 7; i++) {
      const res = await agent
        .post('/api/auth/forgot-password')
        .set('X-CSRF-Token', csrf)
        .send({ email: `flood-${i}@test.local` });
      results.push(res.status);
    }
    expect(results).toContain(429);
  });
});
