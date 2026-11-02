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
        content: { footerEn: 'BE EQUIPPED & SENT' },
      });
    expect(first.status).toBe(200);
    expect(first.body.facebookUrl).toBe('https://facebook.com/thegodnation');
    expect(first.body.content.footerEn).toBe('BE EQUIPPED & SENT');

    // A second, partial update must merge content rather than replace it.
    const second = await agent
      .patch('/api/admin/settings')
      .set('X-CSRF-Token', csrf)
      .send({ content: { contactInfoEn: 'BEGIN YOUR TRAINING JOURNEY' } });
    expect(second.status).toBe(200);
    expect(second.body.content.footerEn).toBe('BE EQUIPPED & SENT'); // preserved
    expect(second.body.content.contactInfoEn).toBe('BEGIN YOUR TRAINING JOURNEY');
    expect(second.body.facebookUrl).toBe('https://facebook.com/thegodnation'); // untouched scalar preserved
  });

  it('keeps the English and French WhatsApp group links, shows them publicly, and lets the admin clear one', async () => {
    await createAdmin('admin-settings-wa@test.local', 'AdminPass123!');
    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);
    await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: 'admin-settings-wa@test.local', password: 'AdminPass123!' });
    const set = await agent
      .patch('/api/admin/settings')
      .set('X-CSRF-Token', csrf)
      .send({ whatsappGroupEnUrl: 'https://chat.whatsapp.com/ENGLISHGROUP', whatsappGroupFrUrl: 'https://chat.whatsapp.com/FRENCHGROUP', supportWhatsappUrl: 'https://wa.me/237677272261' });
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({ whatsappGroupEnUrl: 'https://chat.whatsapp.com/ENGLISHGROUP', whatsappGroupFrUrl: 'https://chat.whatsapp.com/FRENCHGROUP' });
    // Anyone can see them (they are meant to be joined).
    const pub = await request(app).get('/api/settings/public');
    expect(pub.body).toMatchObject({ whatsappGroupEnUrl: 'https://chat.whatsapp.com/ENGLISHGROUP', whatsappGroupFrUrl: 'https://chat.whatsapp.com/FRENCHGROUP', supportWhatsappUrl: 'https://wa.me/237677272261' });
    // An unrelated update leaves them; null clears just one.
    await agent.patch('/api/admin/settings').set('X-CSRF-Token', csrf).send({ facebookUrl: 'https://facebook.com/thegodnation' });
    const cleared = await agent.patch('/api/admin/settings').set('X-CSRF-Token', csrf).send({ whatsappGroupFrUrl: null });
    expect(cleared.body.whatsappGroupEnUrl).toBe('https://chat.whatsapp.com/ENGLISHGROUP');
    expect(cleared.body.whatsappGroupFrUrl).toBeNull();
    // Not a link: refused.
    expect((await agent.patch('/api/admin/settings').set('X-CSRF-Token', csrf).send({ whatsappGroupEnUrl: 'join us' })).status).toBe(400);
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
