import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';

const app = createApp();

async function loginAs(email: string, password: string) {
  const agent = request.agent(app);
  const { csrf } = await bootstrap(agent);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password });
  return { agent, csrf };
}

describe('Phase 2 — Public Contact form', () => {
  it('accepts a valid submission, saves it, and never echoes server configuration back to the client', async () => {
    await prisma.settings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', contactEmail: 'admin-recipient@example.com' },
      update: { contactEmail: 'admin-recipient@example.com' },
    });

    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);
    const res = await agent
      .post('/api/contact')
      .set('X-CSRF-Token', csrf)
      .set('X-Forwarded-For', '10.0.0.1')
      .send({ name: 'Jane Visitor', email: 'jane@example.com', message: 'Hello, I have a question.', language: 'en' });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    // The response must never reveal the configured recipient address, the
    // RESEND_API_KEY, or any other server-side configuration.
    expect(JSON.stringify(res.body)).not.toMatch(/admin-recipient@example\.com/);
    expect(JSON.stringify(res.body)).not.toMatch(/RESEND/i);

    const saved = await prisma.contactMessage.findFirst({ where: { email: 'jane@example.com' } });
    expect(saved).toBeTruthy();
    expect(saved!.message).toBe('Hello, I have a question.');
    expect(saved!.language).toBe('en');
  });

  it('rejects an invalid submission with a 400 and does not save it', async () => {
    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);
    const res = await agent
      .post('/api/contact')
      .set('X-CSRF-Token', csrf)
      .set('X-Forwarded-For', '10.0.0.2')
      .send({ name: '', email: 'not-an-email', message: '', language: 'en' });

    expect(res.status).toBe(400);
    const count = await prisma.contactMessage.count();
    expect(count).toBe(0);
  });

  it('silently drops a honeypot-tripped submission without saving it or sending email', async () => {
    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);
    const res = await agent
      .post('/api/contact')
      .set('X-CSRF-Token', csrf)
      .set('X-Forwarded-For', '10.0.0.3')
      .send({
        name: 'Bot',
        email: 'bot@example.com',
        message: 'spam',
        language: 'en',
        website: 'http://spam.example',
      });

    // Reports success either way — never tips off the bot.
    expect(res.status).toBe(201);
    const saved = await prisma.contactMessage.findFirst({ where: { email: 'bot@example.com' } });
    expect(saved).toBeNull();
  });

  it('rate-limits repeated submissions from the same client', async () => {
    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);

    let lastStatus = 0;
    for (let i = 0; i < 6; i++) {
      const res = await agent
        .post('/api/contact')
        .set('X-CSRF-Token', csrf)
        .set('X-Forwarded-For', '10.0.0.4')
        .send({ name: 'Repeat', email: `repeat${i}@example.com`, message: 'Testing rate limit.', language: 'en' });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });

  it('rejects a submission without a valid CSRF token', async () => {
    const agent = request.agent(app);
    await bootstrap(agent);
    const res = await agent
      .post('/api/contact')
      .set('X-Forwarded-For', '10.0.0.5')
      .send({ name: 'No CSRF', email: 'nocsrf@example.com', message: 'Missing token.', language: 'en' });
    expect(res.status).toBe(403);
  });

  it('lets Admin view saved messages, and never lets an unauthenticated visitor', async () => {
    await prisma.contactMessage.create({
      data: { name: 'Visible', email: 'visible@example.com', message: 'Hi', language: 'en' },
    });

    const anon = request.agent(app);
    await bootstrap(anon);
    const anonRes = await anon.get('/api/admin/messages');
    expect(anonRes.status).toBe(401);

    await createAdmin('admin-messages@test.local', 'AdminPass123!');
    const { agent } = await loginAs('admin-messages@test.local', 'AdminPass123!');
    const res = await agent.get('/api/admin/messages');
    expect(res.status).toBe(200);
    expect(res.body.items.some((m: any) => m.email === 'visible@example.com')).toBe(true);
  });
});
