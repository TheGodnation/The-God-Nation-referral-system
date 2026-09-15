import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createLeader, setLeaderSignupPhrase } from './helpers';
import { bootstrap } from './testUtils';

const app = createApp();

async function signupAttempt(body: Record<string, unknown>) {
  const agent = request.agent(app);
  const { csrf } = await bootstrap(agent);
  const res = await agent.post('/api/auth/leader-signup').set('X-CSRF-Token', csrf).send(body);
  return { agent, res };
}

describe('Acceptance Test — Leader self-signup', () => {
  it('rejects signup when no access phrase has been configured', async () => {
    const { res } = await signupAttempt({
      name: 'New Leader',
      email: 'new-leader1@example.com',
      password: 'SuperSecret1!',
      phrase: 'anything',
    });
    expect(res.status).toBe(403);

    const user = await prisma.user.findUnique({ where: { email: 'new-leader1@example.com' } });
    expect(user).toBeNull();
  });

  it('rejects the wrong access phrase', async () => {
    await setLeaderSignupPhrase('GODSNATION2026');

    const { res } = await signupAttempt({
      name: 'New Leader',
      email: 'new-leader2@example.com',
      password: 'SuperSecret1!',
      phrase: 'WrongPhrase',
    });
    expect(res.status).toBe(403);

    const user = await prisma.user.findUnique({ where: { email: 'new-leader2@example.com' } });
    expect(user).toBeNull();
  });

  it('rejects an email already used by another account', async () => {
    await setLeaderSignupPhrase('GODSNATION2026');
    await createLeader('Existing Leader', 'taken-signup@example.com', 'EXISTCODE1');

    const { res } = await signupAttempt({
      name: 'New Leader',
      email: 'taken-signup@example.com',
      password: 'SuperSecret1!',
      phrase: 'GODSNATION2026',
    });
    expect(res.status).toBe(409);
  });

  it('creates an active, self-registered Leader with a unique auto-generated referral code and logs them in', async () => {
    await setLeaderSignupPhrase('GODSNATION2026');

    const { agent, res } = await signupAttempt({
      name: 'Mary Ngu',
      email: 'mary-signup@example.com',
      password: 'SuperSecret1!',
      phrase: '  GODSNATION2026  ', // surrounding whitespace should still match
    });

    expect(res.status).toBe(201);
    expect(res.body.user).toEqual(
      expect.objectContaining({ name: 'Mary Ngu', email: 'mary-signup@example.com', role: 'LEADER' }),
    );
    expect(typeof res.body.referralCode).toBe('string');
    expect(res.body.referralCode.length).toBeGreaterThan(0);

    const user = await prisma.user.findUnique({ where: { email: 'mary-signup@example.com' } });
    expect(user).toBeTruthy();
    expect(user!.role).toBe('LEADER');
    expect(user!.active).toBe(true);
    expect(user!.selfRegistered).toBe(true);
    expect(user!.mustChangePassword).toBe(false);

    const code = await prisma.referralCode.findUnique({ where: { code: res.body.referralCode } });
    expect(code).toBeTruthy();
    expect(code!.leaderId).toBe(user!.id);
    expect(code!.active).toBe(true);

    // Session was created — the new Leader is immediately logged in.
    const meRes = await agent.get('/api/auth/me');
    expect(meRes.body.user.email).toBe('mary-signup@example.com');

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'LEADER_SELF_REGISTERED', targetId: user!.id },
    });
    expect(audit).toBeTruthy();
  });

  it('never collides referral codes for leaders sharing the same name', async () => {
    await setLeaderSignupPhrase('GODSNATION2026');

    const first = await signupAttempt({
      name: 'John Doe',
      email: 'john-doe-1@example.com',
      password: 'SuperSecret1!',
      phrase: 'GODSNATION2026',
    });
    const second = await signupAttempt({
      name: 'John Doe',
      email: 'john-doe-2@example.com',
      password: 'SuperSecret1!',
      phrase: 'GODSNATION2026',
    });

    expect(first.res.status).toBe(201);
    expect(second.res.status).toBe(201);
    expect(first.res.body.referralCode).not.toBe(second.res.body.referralCode);
  });
});
