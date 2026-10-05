import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { MEMBER_SESSION_MAX_AGE_MS } from '../lib/env';
import { bootstrap } from './testUtils';

// Email-only sign-in with a 6-digit code, and the rolling 90-day session.
const app = createApp();

let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.118.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) {
    wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', ip);
  }
  return wrapped;
}

let n = 0;
async function memberWithAccount() {
  n += 1;
  const email = `code${n}@example.com`;
  const person = await prisma.person.create({ data: { name: `Code Person ${n}`, whatsappNumber: `+2376706${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() } });
  await prisma.memberAccount.create({ data: { personId: person.id, email } });
  return { email, person };
}

async function requestCode(email: string) {
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  const res = await agent.post('/api/member/auth/request-code').set('X-CSRF-Token', csrf).send({ email });
  const call = spy.mock.calls[0]?.[0];
  spy.mockRestore();
  return { res, agent, csrf, code: call?.code as string | undefined, link: call?.link as string | undefined };
}

afterEach(() => vi.restoreAllMocks());

describe('Sign in with email and a 6-digit code', () => {
  it('emails a 6-digit code and a link to a member', async () => {
    const { email } = await memberWithAccount();
    const { res, code, link } = await requestCode(email.toUpperCase());
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('If this email belongs to a member, we sent a 6-digit code to it.');
    expect(code).toMatch(/^\d{6}$/);
    expect(link).toContain('/member/login/confirm?token=');
  });

  it('gives the same reply for an unknown email and sends nothing', async () => {
    const { res, code } = await requestCode('nobody-here@example.com');
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('If this email belongs to a member, we sent a 6-digit code to it.');
    expect(code).toBeUndefined();
  });

  it('signs in with the right code, only once', async () => {
    const { email } = await memberWithAccount();
    const { agent, csrf, code } = await requestCode(email);
    const ok = await agent.post('/api/member/auth/verify-code').set('X-CSRF-Token', csrf).send({ email, code });
    expect(ok.status).toBe(200);
    expect((await agent.get('/api/member/auth/me')).body.member.email).toBe(email);

    const again = await agent.post('/api/member/auth/verify-code').set('X-CSRF-Token', csrf).send({ email, code });
    expect(again.status).toBe(400);
  });

  it('stops working after 5 wrong tries', async () => {
    const { email } = await memberWithAccount();
    const { agent, csrf, code } = await requestCode(email);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      const r = await agent.post('/api/member/auth/verify-code').set('X-CSRF-Token', csrf).send({ email, code: wrong });
      expect(r.body.code).toBe('BAD_CODE');
    }
    const late = await agent.post('/api/member/auth/verify-code').set('X-CSRF-Token', csrf).send({ email, code });
    expect(late.status).toBe(400);
  });

  it('only the newest code counts', async () => {
    const { email } = await memberWithAccount();
    const first = await requestCode(email);
    const second = await requestCode(email);
    if (first.code !== second.code) {
      const old = await second.agent.post('/api/member/auth/verify-code').set('X-CSRF-Token', second.csrf).send({ email, code: first.code });
      expect(old.status).toBe(400);
    }
    const ok = await second.agent.post('/api/member/auth/verify-code').set('X-CSRF-Token', second.csrf).send({ email, code: second.code });
    expect(ok.status).toBe(200);
  });

  it('the old phone + email request also includes a code now', async () => {
    const { email, person } = await memberWithAccount();
    const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    await agent.post('/api/member/auth/request-link').set('X-CSRF-Token', csrf).send({ whatsapp: person.whatsappNumber, email });
    expect(spy.mock.calls[0][0].code).toMatch(/^\d{6}$/);
  });
});

describe('Staying signed in (90 days, renewed while active)', () => {
  it('pushes an older session’s expiry back to 90 days when the member comes back', async () => {
    const { email } = await memberWithAccount();
    const { agent, csrf, code } = await requestCode(email);
    await agent.post('/api/member/auth/verify-code').set('X-CSRF-Token', csrf).send({ email, code });

    // Pretend the session was created 10 days ago.
    const session = await prisma.memberSession.findFirst({ orderBy: { createdAt: 'desc' } });
    const tenDaysLess = new Date(Date.now() + MEMBER_SESSION_MAX_AGE_MS - 10 * 86400000);
    await prisma.memberSession.update({ where: { id: session!.id }, data: { expiresAt: tenDaysLess } });

    const me = await agent.get('/api/member/auth/me');
    expect(me.body.member).toBeTruthy();
    expect(String(me.headers['set-cookie'] ?? '')).toContain('msid=');

    // The update is fire-and-forget; give it a moment.
    await new Promise((r) => setTimeout(r, 200));
    const renewed = await prisma.memberSession.findUnique({ where: { id: session!.id } });
    expect(renewed!.expiresAt.getTime()).toBeGreaterThan(tenDaysLess.getTime() + 5 * 86400000);
  });
});
