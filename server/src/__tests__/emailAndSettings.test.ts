import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';
import * as emailModule from '../lib/email';

const app = createApp();

describe('Registration confirmation email', () => {
  afterEach(() => vi.restoreAllMocks());

  it('registration still succeeds even when the confirmation email fails', async () => {
    vi.spyOn(emailModule.EmailService, 'sendRegistrationConfirmation').mockRejectedValue(new Error('SMTP down'));

    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);
    const res = await agent
      .post('/api/registrations')
      .set('X-CSRF-Token', csrf)
      .send({
        name: 'Email Fail Test',
        whatsapp: '+237670003001',
        language: 'en',
        pathway: 'TRAINING',
        email: 'visitor@example.com',
      });

    expect(res.status).toBe(201);
    expect(res.body.confirmationEmailSent).toBe(false);

    const registration = await prisma.registration.findUnique({ where: { id: res.body.registrationId } });
    expect(registration).toBeTruthy(); // no rollback
  });

  it('registration succeeds normally when no email is provided at all', async () => {
    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);
    const res = await agent
      .post('/api/registrations')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'No Email Test', whatsapp: '+237670003002', language: 'en', pathway: 'TRAINING' });

    expect(res.status).toBe(201);
    expect(res.body.confirmationEmailSent).toBe(false);
  });

  it('sends the confirmation email when delivery succeeds', async () => {
    const spy = vi.spyOn(emailModule.EmailService, 'sendRegistrationConfirmation').mockResolvedValue({ ok: true });
    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);
    const res = await agent
      .post('/api/registrations')
      .set('X-CSRF-Token', csrf)
      .send({
        name: 'Email Success Test',
        whatsapp: '+237670003003',
        language: 'fr',
        pathway: 'DISCOVER_GROW',
        email: 'confirmed@example.com',
      });

    expect(res.status).toBe(201);
    expect(res.body.confirmationEmailSent).toBe(true);
    expect(spy).toHaveBeenCalledWith({
      to: 'confirmed@example.com',
      name: 'Email Success Test',
      language: 'fr',
      link: expect.stringContaining(`/api/registrations/${res.body.registrationId}/whatsapp`),
    });
  });
});

// The "Leader emails their referral link to someone" feature (POST
// /api/leader/invite) was removed to protect the shared daily Resend
// sending cap — Leaders still have WhatsApp/Messenger/copy-link/native
// share, none of which touch email.

describe('Admin Settings — extended fields', () => {
  it('persists WhatsApp destinations, social URLs, and content, merging rather than clobbering', async () => {
    await createAdmin('admin-settings@test.local', 'AdminPass123!');
    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);
    await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: 'admin-settings@test.local', password: 'AdminPass123!' });

    const first = await agent
      .patch('/api/admin/settings')
      .set('X-CSRF-Token', csrf)
      .send({
        whatsappUrlDiscoverEn: 'https://wa.example/discover-en',
        facebookUrl: 'https://facebook.com/thegodnation',
        // Content is bilingual — every key is stored per-language (En/Fr)
        // so one language's edit never overrides the other's.
        content: { homepageTitleEn: 'BE EQUIPPED & SENT' },
      });
    expect(first.status).toBe(200);
    expect(first.body.whatsappUrlDiscoverEn).toBe('https://wa.example/discover-en');
    expect(first.body.facebookUrl).toBe('https://facebook.com/thegodnation');
    expect(first.body.content.homepageTitleEn).toBe('BE EQUIPPED & SENT');

    // A second, partial update must merge content rather than replace it.
    const second = await agent
      .patch('/api/admin/settings')
      .set('X-CSRF-Token', csrf)
      .send({ content: { trainingTitleEn: 'BEGIN YOUR TRAINING JOURNEY' } });
    expect(second.status).toBe(200);
    expect(second.body.content.homepageTitleEn).toBe('BE EQUIPPED & SENT'); // preserved
    expect(second.body.content.trainingTitleEn).toBe('BEGIN YOUR TRAINING JOURNEY');
    expect(second.body.facebookUrl).toBe('https://facebook.com/thegodnation'); // untouched scalar preserved
  });

  it('rejects an invalid social URL', async () => {
    await createAdmin('admin-settings2@test.local', 'AdminPass123!');
    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);
    await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: 'admin-settings2@test.local', password: 'AdminPass123!' });

    const res = await agent
      .patch('/api/admin/settings')
      .set('X-CSRF-Token', csrf)
      .send({ instagramUrl: 'not-a-url' });
    expect(res.status).toBe(400);
  });
});
