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
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password });
  return { agent, csrf };
}

describe('Phase 2 — Public content pages (Admin management)', () => {
  it('lets Admin create, edit, and publish a page; public reads only see it once published', async () => {
    await createAdmin('admin-content@test.local', 'AdminPass123!');
    const { agent, csrf } = await loginAs('admin-content@test.local', 'AdminPass123!');

    const create = await agent
      .post('/api/admin/content-pages')
      .set('X-CSRF-Token', csrf)
      .send({
        type: 'PAGE',
        slug: 'vision',
        titleEn: 'Our Vision',
        titleFr: 'Notre Vision',
        bodyEn: 'To reach every nation.',
        bodyFr: 'Atteindre chaque nation.',
      });
    expect(create.status).toBe(201);
    expect(create.body.published).toBe(false);
    const id = create.body.id;

    // Unpublished — public reads must 404, both by slug and in the list.
    const publicVisitorAgent = request.agent(app);
    await bootstrap(publicVisitorAgent);
    const unpublishedGet = await publicVisitorAgent.get('/api/content-pages/vision');
    expect(unpublishedGet.status).toBe(404);
    const listBeforePublish = await publicVisitorAgent.get('/api/content-pages?type=PAGE');
    expect(listBeforePublish.body.items.find((p: any) => p.slug === 'vision')).toBeUndefined();

    // Edit
    const edit = await agent
      .patch(`/api/admin/content-pages/${id}`)
      .set('X-CSRF-Token', csrf)
      .send({ bodyEn: 'To reach every nation with the Gospel.' });
    expect(edit.status).toBe(200);
    expect(edit.body.bodyEn).toBe('To reach every nation with the Gospel.');

    // Publish
    const publish = await agent
      .patch(`/api/admin/content-pages/${id}`)
      .set('X-CSRF-Token', csrf)
      .send({ published: true });
    expect(publish.status).toBe(200);
    expect(publish.body.published).toBe(true);
    expect(publish.body.publishedAt).toBeTruthy();

    // Now publicly visible — English rendering.
    const publishedGet = await publicVisitorAgent.get('/api/content-pages/vision');
    expect(publishedGet.status).toBe(200);
    expect(publishedGet.body.titleEn).toBe('Our Vision');
    expect(publishedGet.body.bodyEn).toBe('To reach every nation with the Gospel.');
    // French rendering — same row carries both languages.
    expect(publishedGet.body.titleFr).toBe('Notre Vision');
    expect(publishedGet.body.bodyFr).toBe('Atteindre chaque nation.');

    const listAfterPublish = await publicVisitorAgent.get('/api/content-pages?type=PAGE');
    expect(listAfterPublish.body.items.find((p: any) => p.slug === 'vision')).toBeTruthy();

    // Unpublish again — 404s once more.
    const unpublish = await agent
      .patch(`/api/admin/content-pages/${id}`)
      .set('X-CSRF-Token', csrf)
      .send({ published: false });
    expect(unpublish.status).toBe(200);
    expect(unpublish.body.publishedAt).toBeNull();
    const afterUnpublish = await publicVisitorAgent.get('/api/content-pages/vision');
    expect(afterUnpublish.status).toBe(404);

    // Delete.
    const del = await agent.delete(`/api/admin/content-pages/${id}`).set('X-CSRF-Token', csrf);
    expect(del.status).toBe(204);
    const gone = await prisma.contentPage.findUnique({ where: { id } });
    expect(gone).toBeNull();
  });

  it('rejects a missing slug on public read the same way as an unpublished one', async () => {
    const visitorAgent = request.agent(app);
    await bootstrap(visitorAgent);
    const res = await visitorAgent.get('/api/content-pages/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('never lets an unauthenticated visitor create, edit, or delete content', async () => {
    const visitorAgent = request.agent(app);
    const { csrf } = await bootstrap(visitorAgent);

    const create = await visitorAgent
      .post('/api/admin/content-pages')
      .set('X-CSRF-Token', csrf)
      .send({ type: 'PAGE', slug: 'hack', titleEn: 'x', bodyEn: 'x' });
    expect(create.status).toBe(401);
  });

  it('never lets a Leader (wrong role) manage content pages', async () => {
    await createLeader('Content Leader', 'leader-content@example.com', 'LEADCP1');
    const { agent, csrf } = await loginAs('leader-content@example.com', 'password123');

    const create = await agent
      .post('/api/admin/content-pages')
      .set('X-CSRF-Token', csrf)
      .send({ type: 'PAGE', slug: 'hack2', titleEn: 'x', bodyEn: 'x' });
    expect(create.status).toBe(403);
  });

  it('requires public content-page reads to work without any login', async () => {
    await createAdmin('admin-public-check@test.local', 'AdminPass123!');
    const { agent, csrf } = await loginAs('admin-public-check@test.local', 'AdminPass123!');
    const create = await agent
      .post('/api/admin/content-pages')
      .set('X-CSRF-Token', csrf)
      .send({ type: 'TEACHING', slug: 'no-login-needed', titleEn: 'Teaching', bodyEn: 'Body text.' });
    await agent.patch(`/api/admin/content-pages/${create.body.id}`).set('X-CSRF-Token', csrf).send({ published: true });

    // A brand-new, never-authenticated agent.
    const anon = request.agent(app);
    const res = await anon.get('/api/content-pages/no-login-needed');
    expect(res.status).toBe(200);
    expect(res.body.titleEn).toBe('Teaching');
  });
});
