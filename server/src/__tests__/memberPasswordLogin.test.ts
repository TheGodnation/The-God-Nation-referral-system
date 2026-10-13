import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { bootstrap } from './testUtils';

// Member email + password sign-in — the ordinary, repeatable way back in
// once someone has already signed up. Codes are only ever emailed during
// signup (memberCodeSignin.test.ts covers that) or on the "forgot
// password" screen; this file covers the plain POST /login path itself.
const app = createApp();

let ipCounter = 0;
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

let n = 0;
async function memberWithPassword(password = 'Testpass123') {
  n += 1;
  const email = `pw${n}@example.com`;
  const passwordHash = await bcrypt.hash(password, 12);
  const person = await prisma.person.create({
    data: { name: `Password Person ${n}`, whatsappNumber: `+2376707${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() },
  });
  await prisma.memberAccount.create({ data: { personId: person.id, email, passwordHash } });
  return { email, password, person };
}

async function memberWithoutPassword() {
  n += 1;
  const email = `nopw${n}@example.com`;
  const person = await prisma.person.create({
    data: { name: `No Password Person ${n}`, whatsappNumber: `+2376708${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() },
  });
  await prisma.memberAccount.create({ data: { personId: person.id, email } });
  return { email, person };
}

afterEach(() => vi.restoreAllMocks());

describe('Member sign-in with email and password', () => {
  it('signs in with the right email and password', async () => {
    const { email, password } = await memberWithPassword();
    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    const res = await agent.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email, password });
    expect(res.status).toBe(200);
    expect(res.body.member.email).toBe(email);
    expect((await agent.get('/api/member/auth/me')).body.member.email).toBe(email);
    expect(String(res.headers['set-cookie'] ?? '')).toContain('msid=');
  });

  it('rejects the wrong password with a generic message', async () => {
    const { email } = await memberWithPassword();
    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    const res = await agent.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'WrongPassword1' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid email or password.', code: 'INVALID_CREDENTIALS' });
  });

  it('rejects an unknown email with the exact same reply as a wrong password', async () => {
    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    const res = await agent.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email: 'nobody@example.com', password: 'WhateverPass1' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid email or password.', code: 'INVALID_CREDENTIALS' });
  });

  it('rejects a member who signed up before passwords existed, with the same generic reply — never revealing the difference', async () => {
    const { email } = await memberWithoutPassword();
    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    const res = await agent.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'AnyPassword1' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid email or password.', code: 'INVALID_CREDENTIALS' });
  });

  it('is case-insensitive on email', async () => {
    const { email, password } = await memberWithPassword();
    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    const res = await agent.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email: email.toUpperCase(), password });
    expect(res.status).toBe(200);
  });

  it('locks out after repeated wrong attempts for the same email', async () => {
    const { email } = await memberWithPassword();
    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    for (let i = 0; i < 5; i++) {
      await agent.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'WrongPassword1' });
    }
    const locked = await agent.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'WrongPassword1' });
    expect(locked.status).toBe(429);
  });

  it('never sends an email for a plain password sign-in', async () => {
    const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
    const { email, password } = await memberWithPassword();
    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    await agent.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email, password });
    expect(spy).not.toHaveBeenCalled();
  });
});
