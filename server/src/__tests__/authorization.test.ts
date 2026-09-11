import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createLeader, createAdmin } from './helpers';
import { bootstrap } from './testUtils';

const app = createApp();

async function loginAs(email: string, password: string) {
  const agent = request.agent(app);
  const { csrf } = await bootstrap(agent);
  const res = await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password });
  return { agent, csrf, res };
}

describe('Acceptance Test — authorization', () => {
  it('prevents a Leader from accessing Admin endpoints', async () => {
    await createLeader('Mary Ngu', 'mary@example.com', 'MARY7X2');
    const { agent } = await loginAs('mary@example.com', 'password123');

    const res = await agent.get('/api/admin/dashboard');
    expect(res.status).toBe(403);
  });

  it('isolates each Leader to their own dashboard/referrals data', async () => {
    const { user: mary } = await createLeader('Mary Ngu', 'mary@example.com', 'MARY7X2');
    await createLeader('John Tabi', 'john@example.com', 'JOHN8K4');

    // A referred registration for Mary only.
    const visitorAgent = request.agent(app);
    const { csrf } = await bootstrap(visitorAgent);
    await visitorAgent.post('/api/referrals/visit').set('X-CSRF-Token', csrf).send({ ref: 'MARY7X2', lang: 'en' });
    await visitorAgent
      .post('/api/registrations')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Mary Referral', whatsapp: '+237670000050', language: 'en', pathway: 'TRAINING' });

    const { agent: johnAgent } = await loginAs('john@example.com', 'password123');
    const johnDash = await johnAgent.get('/api/leader/dashboard');
    expect(johnDash.status).toBe(200);
    expect(johnDash.body.stats.conversionRate).toBe(0); // John sees none of Mary's data

    const johnReferrals = await johnAgent.get('/api/leader/referrals');
    expect(johnReferrals.body.items).toHaveLength(0);

    const { agent: maryAgent } = await loginAs('mary@example.com', 'password123');
    const maryReferrals = await maryAgent.get('/api/leader/referrals');
    expect(maryReferrals.body.items).toHaveLength(1);
    expect(maryReferrals.body.items[0].whatsapp).toBe('+237670000050');
  });

  it('never trusts a client-supplied leaderId for referral endpoints (server uses session identity only)', async () => {
    const { user: mary } = await createLeader('Mary Ngu', 'mary@example.com', 'MARY7X2');
    const { agent } = await loginAs('mary@example.com', 'password123');

    // Attempt to view another leader's data via a query-string manipulation;
    // the route ignores any client-supplied id and always uses req.user.id.
    const res = await agent.get(`/api/leader/dashboard?leaderId=someone-else`);
    expect(res.status).toBe(200);
    expect(res.body.referralCode).toBe('MARY7X2'); // still Mary's own data
  });

  it('requires authentication for Leader and Admin endpoints', async () => {
    const anon = request.agent(app);
    const res1 = await anon.get('/api/leader/dashboard');
    expect(res1.status).toBe(401);
    const res2 = await anon.get('/api/admin/dashboard');
    expect(res2.status).toBe(401);
  });

  it('allows a properly authenticated Admin to manage leaders', async () => {
    await createAdmin('admin@test.local', 'AdminPass123!');
    const { agent } = await loginAs('admin@test.local', 'AdminPass123!');

    const res = await agent.get('/api/admin/leaders');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });
});

describe('Acceptance Test — security fundamentals', () => {
  it('never stores plaintext passwords', async () => {
    const admin = await createAdmin('admin2@test.local', 'AdminPass123!');
    expect(admin.passwordHash).not.toBe('AdminPass123!');
    expect(admin.passwordHash.startsWith('$2')).toBe(true); // bcrypt hash prefix
  });

  it('rejects mutating requests without a valid CSRF token', async () => {
    await createLeader('Mary Ngu', 'mary@example.com', 'MARY7X2');
    const agent = request.agent(app);
    await bootstrap(agent);
    const res = await agent
      .post('/api/auth/login')
      // no X-CSRF-Token header set
      .send({ email: 'mary@example.com', password: 'password123' });
    expect(res.status).toBe(403);
  });

  it('rejects invalid credentials without revealing which field was wrong', async () => {
    await createLeader('Mary Ngu', 'mary@example.com', 'MARY7X2');
    const { res } = await loginAs('mary@example.com', 'wrong-password');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password.');
  });

  it('uses opaque, unguessable session tokens (not stored in plaintext)', async () => {
    await createAdmin('admin3@test.local', 'AdminPass123!');
    const { agent } = await loginAs('admin3@test.local', 'AdminPass123!');
    const sessions = await prisma.session.findMany();
    expect(sessions.length).toBeGreaterThan(0);
    // Only a hash is stored — never the raw cookie value.
    for (const s of sessions) {
      expect(s.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    }
    const me = await agent.get('/api/auth/me');
    expect(me.body.user.email).toBe('admin3@test.local');
  });

  it('sets httpOnly, SameSite=Lax visitor and session cookies', async () => {
    await createAdmin('admin4@test.local', 'AdminPass123!');
    const agent = request.agent(app);
    const bootstrapRes = await agent.get('/api/auth/me');
    const setCookies: string[] = bootstrapRes.headers['set-cookie'] || [];
    const visitorCookieLine = setCookies.find((c) => c.startsWith('visitor_id='));
    expect(visitorCookieLine).toBeTruthy();
    expect(visitorCookieLine!).toMatch(/HttpOnly/i);
    expect(visitorCookieLine!).toMatch(/SameSite=Lax/i);

    const { csrf } = { csrf: setCookies.find((c) => c.startsWith('csrf_token='))!.split(';')[0].split('=')[1] };
    const loginRes = await agent
      .post('/api/auth/login')
      .set('X-CSRF-Token', csrf)
      .send({ email: 'admin4@test.local', password: 'AdminPass123!' });
    const loginCookies: string[] = loginRes.headers['set-cookie'] || [];
    const sidLine = loginCookies.find((c) => c.startsWith('sid='));
    expect(sidLine).toBeTruthy();
    expect(sidLine!).toMatch(/HttpOnly/i);
    expect(sidLine!).toMatch(/SameSite=Lax/i);
  });
});
