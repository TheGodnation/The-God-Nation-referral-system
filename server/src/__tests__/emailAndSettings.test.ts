import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';

const app = createApp();

// The "Leader emails their referral link to someone" feature (POST
// /api/leader/invite) was removed to protect the shared daily Resend
// sending cap — Leaders still have WhatsApp/Messenger/copy-link/native
// share, none of which touch email.

describe('Admin Settings — extended fields', () => {
  it('persists social URLs and content, merging rather than clobbering', async () => {
    await createAdmin('admin-settings@test.local', 'AdminPass123!');
    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);
    await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: 'admin-settings@test.local', password: 'AdminPass123!' });

    const first = await agent
      .patch('/api/admin/settings')
      .set('X-CSRF-Token', csrf)
      .send({
        facebookUrl: 'https://facebook.com/thegodnation',
        // Content is bilingual — every key is stored per-language (En/Fr)
        // so one language's edit never overrides the other's.
        content: { homepageTitleEn: 'BE EQUIPPED & SENT' },
      });
    expect(first.status).toBe(200);
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

  it('sets, preserves, and clears the leader signup access phrase', async () => {
    await createAdmin('admin-settings3@test.local', 'AdminPass123!');
    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);
    await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: 'admin-settings3@test.local', password: 'AdminPass123!' });

    const first = await agent
      .patch('/api/admin/settings')
      .set('X-CSRF-Token', csrf)
      .send({ leaderSignupPhrase: 'GODSNATION2026' });
    expect(first.status).toBe(200);
    expect(first.body.leaderSignupPhrase).toBe('GODSNATION2026');

    // An unrelated update must not touch it.
    const second = await agent
      .patch('/api/admin/settings')
      .set('X-CSRF-Token', csrf)
      .send({ facebookUrl: 'https://facebook.com/thegodnation' });
    expect(second.status).toBe(200);
    expect(second.body.leaderSignupPhrase).toBe('GODSNATION2026');

    // Blanking it explicitly turns self-signup off.
    const third = await agent
      .patch('/api/admin/settings')
      .set('X-CSRF-Token', csrf)
      .send({ leaderSignupPhrase: '' });
    expect(third.status).toBe(200);
    expect(third.body.leaderSignupPhrase).toBeNull();
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
