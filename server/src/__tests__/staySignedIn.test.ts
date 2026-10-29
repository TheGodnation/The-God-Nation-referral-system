import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';
import { SESSION_MAX_AGE_MS, MEMBER_SESSION_MAX_AGE_MS } from '../lib/env';

// Staying signed in: 90 days for everyone (members, leaders, admins), and
// renewed whenever they come back, so nobody is asked for a password out of
// the blue while they keep using the app.
const app = createApp();
const DAY = 24 * 60 * 60 * 1000;

describe('Staying signed in for 90 days', () => {
  it('is 90 days for members and for leaders / admins', () => {
    expect(MEMBER_SESSION_MAX_AGE_MS).toBe(90 * DAY);
    expect(SESSION_MAX_AGE_MS).toBe(90 * DAY);
  });

  it('a leader / admin session lasts 90 days from sign-in, and coming back pushes it out again', async () => {
    const email = `stay-admin-${Math.random().toString(36).slice(2, 8)}@test.local`;
    await createAdmin(email, 'AdminPass123!');
    const agent = request.agent(app);
    const ip = `10.153.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`;
    const { csrf } = await bootstrap(agent as any);
    const login = await agent.post('/api/auth/login').set('X-Forwarded-For', ip).set('X-CSRF-Token', csrf).send({ email, password: 'AdminPass123!' });
    expect(login.status).toBe(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const session = await prisma.session.findFirstOrThrow({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } });
    // Signed in for 90 days (not the old 7).
    expect(session.expiresAt.getTime() - Date.now()).toBeGreaterThan(89 * DAY);

    // 40 days later (only 50 left): opening the app renews it to a full 90 and refreshes the cookie.
    const fiftyDaysLeft = new Date(Date.now() + 50 * DAY);
    await prisma.session.update({ where: { id: session.id }, data: { expiresAt: fiftyDaysLeft } });
    const me = await agent.get('/api/auth/me').set('X-Forwarded-For', ip);
    expect(me.status).toBe(200);
    expect(String(me.headers['set-cookie'] ?? '')).toContain('sid=');
    await new Promise((r) => setTimeout(r, 200));
    const renewed = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(renewed.expiresAt.getTime() - Date.now()).toBeGreaterThan(89 * DAY);
  });
});
