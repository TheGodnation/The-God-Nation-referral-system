import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';

const app = createApp();

describe('mustChangePassword enforcement', () => {
  it('exposes mustChangePassword on login and on GET /api/auth/me', async () => {
    const admin = await createAdmin('admin@test.local', 'AdminPass123!');
    expect(admin.mustChangePassword).toBe(false); // createAdmin test helper defaults to false

    // Force it true to simulate a bootstrap/newly-created account.
    await prisma.user.update({ where: { id: admin.id }, data: { mustChangePassword: true } });

    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);
    const loginRes = await agent
      .post('/api/auth/login')
      .set('X-CSRF-Token', csrf)
      .send({ email: 'admin@test.local', password: 'AdminPass123!' });
    expect(loginRes.body.user.mustChangePassword).toBe(true);

    const meRes = await agent.get('/api/auth/me');
    expect(meRes.body.user.mustChangePassword).toBe(true);
  });

  it('rejects change-password with the wrong current password', async () => {
    const admin = await createAdmin('admin2@test.local', 'AdminPass123!');
    await prisma.user.update({ where: { id: admin.id }, data: { mustChangePassword: true } });

    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);
    await agent
      .post('/api/auth/login')
      .set('X-CSRF-Token', csrf)
      .send({ email: 'admin2@test.local', password: 'AdminPass123!' });

    const res = await agent
      .post('/api/auth/change-password')
      .set('X-CSRF-Token', csrf)
      .send({ currentPassword: 'WrongPassword!', newPassword: 'BrandNewPass123!' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Current password is incorrect.');
  });

  it('rejects a new password shorter than 8 characters', async () => {
    const admin = await createAdmin('admin3@test.local', 'AdminPass123!');
    await prisma.user.update({ where: { id: admin.id }, data: { mustChangePassword: true } });

    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);
    await agent
      .post('/api/auth/login')
      .set('X-CSRF-Token', csrf)
      .send({ email: 'admin3@test.local', password: 'AdminPass123!' });

    const res = await agent
      .post('/api/auth/change-password')
      .set('X-CSRF-Token', csrf)
      .send({ currentPassword: 'AdminPass123!', newPassword: 'short' });

    expect(res.status).toBe(400);
  });

  it('requires the new password to differ from the current one', async () => {
    const admin = await createAdmin('admin4@test.local', 'AdminPass123!');
    await prisma.user.update({ where: { id: admin.id }, data: { mustChangePassword: true } });

    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);
    await agent
      .post('/api/auth/login')
      .set('X-CSRF-Token', csrf)
      .send({ email: 'admin4@test.local', password: 'AdminPass123!' });

    const res = await agent
      .post('/api/auth/change-password')
      .set('X-CSRF-Token', csrf)
      .send({ currentPassword: 'AdminPass123!', newPassword: 'AdminPass123!' });

    expect(res.status).toBe(400);
  });

  it('changes the password, clears mustChangePassword, and invalidates the old password', async () => {
    const admin = await createAdmin('admin5@test.local', 'AdminPass123!');
    await prisma.user.update({ where: { id: admin.id }, data: { mustChangePassword: true } });

    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);
    await agent
      .post('/api/auth/login')
      .set('X-CSRF-Token', csrf)
      .send({ email: 'admin5@test.local', password: 'AdminPass123!' });

    const changeRes = await agent
      .post('/api/auth/change-password')
      .set('X-CSRF-Token', csrf)
      .send({ currentPassword: 'AdminPass123!', newPassword: 'BrandNewPass123!' });
    expect(changeRes.status).toBe(200);

    const meRes = await agent.get('/api/auth/me');
    expect(meRes.body.user.mustChangePassword).toBe(false);

    // Old password no longer works.
    const staleAgent = request.agent(app);
    const { csrf: staleCsrf } = await bootstrap(staleAgent);
    const staleLogin = await staleAgent
      .post('/api/auth/login')
      .set('X-CSRF-Token', staleCsrf)
      .send({ email: 'admin5@test.local', password: 'AdminPass123!' });
    expect(staleLogin.status).toBe(401);

    // New password works.
    const freshAgent = request.agent(app);
    const { csrf: freshCsrf } = await bootstrap(freshAgent);
    const freshLogin = await freshAgent
      .post('/api/auth/login')
      .set('X-CSRF-Token', freshCsrf)
      .send({ email: 'admin5@test.local', password: 'BrandNewPass123!' });
    expect(freshLogin.status).toBe(200);
    expect(freshLogin.body.user.mustChangePassword).toBe(false);
  });

  it('requires authentication to change a password', async () => {
    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);
    const res = await agent
      .post('/api/auth/change-password')
      .set('X-CSRF-Token', csrf)
      .send({ currentPassword: 'whatever', newPassword: 'BrandNewPass123!' });
    expect(res.status).toBe(401);
  });
});
