import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createLeader, createAdmin } from './helpers';
import { bootstrap } from './testUtils';

const app = createApp();

async function loginAsAdmin(email = 'admin-devotional@test.local', password = 'AdminPass123!') {
  await createAdmin(email, password);
  const agent = request.agent(app);
  const { csrf } = await bootstrap(agent);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password });
  return { agent, csrf };
}

describe('Phase 3B — Monthly Devotional', () => {
  it('creates, edits, publishes, and archives a devotional with English and French content', async () => {
    const { agent, csrf } = await loginAsAdmin();

    const created = await agent
      .post('/api/admin/devotionals')
      .set('X-CSRF-Token', csrf)
      .send({
        titleEn: 'Walking in Faith',
        titleFr: 'Marcher dans la foi',
        contentEn: 'This month we explore faith.',
        contentFr: 'Ce mois-ci nous explorons la foi.',
        startDate: '2026-10-01',
        endDate: '2026-10-31',
      });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('DRAFT');
    expect(created.body.titleFr).toBe('Marcher dans la foi');

    const edited = await agent
      .patch(`/api/admin/devotionals/${created.body.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ contentEn: 'This month we explore faith, deeply.' });
    expect(edited.status).toBe(200);
    expect(edited.body.contentEn).toBe('This month we explore faith, deeply.');

    const published = await agent
      .patch(`/api/admin/devotionals/${created.body.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ status: 'PUBLISHED' });
    expect(published.status).toBe(200);
    expect(published.body.status).toBe('PUBLISHED');

    const archived = await agent
      .patch(`/api/admin/devotionals/${created.body.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ status: 'ARCHIVED' });
    expect(archived.status).toBe(200);
    expect(archived.body.status).toBe('ARCHIVED');

    const detail = await agent.get(`/api/admin/devotionals/${created.body.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.titleEn).toBe('Walking in Faith');
  });

  it('supports both a global devotional (no community) and one scoped to a Community', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-devotional-community@test.local');
    const community = await agent.post('/api/admin/communities').set('X-CSRF-Token', csrf).send({ name: 'Devotional Community' });

    const global = await agent
      .post('/api/admin/devotionals')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Global Devotional', contentEn: 'For everyone.', startDate: '2026-11-01', endDate: '2026-11-30' });
    expect(global.body.communityId).toBeNull();

    const scoped = await agent
      .post('/api/admin/devotionals')
      .set('X-CSRF-Token', csrf)
      .send({
        titleEn: 'Community Devotional',
        contentEn: 'For this community.',
        communityId: community.body.id,
        startDate: '2026-11-01',
        endDate: '2026-11-30',
      });
    expect(scoped.body.communityId).toBe(community.body.id);
  });

  it('rejects an end date before the start date', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-devotional-dates@test.local');
    const res = await agent
      .post('/api/admin/devotionals')
      .set('X-CSRF-Token', csrf)
      .send({ titleEn: 'Bad Dates', contentEn: 'x', startDate: '2026-11-30', endDate: '2026-11-01' });
    expect(res.status).toBe(400);
  });

  it('requires Admin authorization for every devotional mutation', async () => {
    const anon = request.agent(app);
    const { csrf: anonCsrf } = await bootstrap(anon);
    const anonCreate = await anon
      .post('/api/admin/devotionals')
      .set('X-CSRF-Token', anonCsrf)
      .send({ titleEn: 'Nope', contentEn: 'x', startDate: '2026-11-01', endDate: '2026-11-30' });
    expect(anonCreate.status).toBe(401);

    await createLeader('Devotional Leader', 'leader-devotional@example.com', 'DEVOLD1');
    const leaderAgent = request.agent(app);
    const { csrf: leaderCsrf } = await bootstrap(leaderAgent);
    await leaderAgent
      .post('/api/auth/login')
      .set('X-CSRF-Token', leaderCsrf)
      .send({ email: 'leader-devotional@example.com', password: 'password123' });
    const leaderCreate = await leaderAgent
      .post('/api/admin/devotionals')
      .set('X-CSRF-Token', leaderCsrf)
      .send({ titleEn: 'Nope', contentEn: 'x', startDate: '2026-11-01', endDate: '2026-11-30' });
    expect(leaderCreate.status).toBe(403);
  });
});
