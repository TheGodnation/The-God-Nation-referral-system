import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createAdmin, createLeader } from './helpers';
import { bootstrap } from './testUtils';

const app = createApp();

async function loginAs(agent: ReturnType<typeof request.agent>, email: string, password: string) {
  const { csrf } = await bootstrap(agent);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password });
  return csrf;
}

describe('Self-service login email update', () => {
  it('rejects the wrong current password', async () => {
    await createAdmin('admin-email1@test.local', 'AdminPass123!');
    const agent = request.agent(app);
    const csrf = await loginAs(agent, 'admin-email1@test.local', 'AdminPass123!');

    const res = await agent
      .post('/api/auth/update-email')
      .set('X-CSRF-Token', csrf)
      .send({ currentPassword: 'WrongPassword!', newEmail: 'new-address@example.com' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Current password is incorrect.');
  });

  it('rejects an email already used by another account', async () => {
    await createAdmin('admin-email2@test.local', 'AdminPass123!');
    await createLeader('Mary Ngu', 'taken-address@example.com', 'MARYEMAIL1');

    const agent = request.agent(app);
    const csrf = await loginAs(agent, 'admin-email2@test.local', 'AdminPass123!');

    const res = await agent
      .post('/api/auth/update-email')
      .set('X-CSRF-Token', csrf)
      .send({ currentPassword: 'AdminPass123!', newEmail: 'taken-address@example.com' });

    expect(res.status).toBe(409);
  });

  it('updates the email and lets the account log in with the new address', async () => {
    await createAdmin('admin-email3@test.local', 'AdminPass123!');
    const agent = request.agent(app);
    const csrf = await loginAs(agent, 'admin-email3@test.local', 'AdminPass123!');

    const updateRes = await agent
      .post('/api/auth/update-email')
      .set('X-CSRF-Token', csrf)
      .send({ currentPassword: 'AdminPass123!', newEmail: 'admin-email3-new@example.com' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.email).toBe('admin-email3-new@example.com');

    const meRes = await agent.get('/api/auth/me');
    expect(meRes.body.user.email).toBe('admin-email3-new@example.com');

    // Old email no longer works; new one does.
    const staleAgent = request.agent(app);
    const staleCsrf = await loginAs(staleAgent, 'admin-email3@test.local', 'AdminPass123!');
    const staleMe = await staleAgent.get('/api/auth/me');
    expect(staleMe.body.user).toBeNull();
    void staleCsrf;

    const freshAgent = request.agent(app);
    const freshCsrf = await loginAs(freshAgent, 'admin-email3-new@example.com', 'AdminPass123!');
    const freshMe = await freshAgent.get('/api/auth/me');
    expect(freshMe.body.user.email).toBe('admin-email3-new@example.com');
    void freshCsrf;
  });

  it('requires authentication', async () => {
    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);
    const res = await agent
      .post('/api/auth/update-email')
      .set('X-CSRF-Token', csrf)
      .send({ currentPassword: 'whatever', newEmail: 'someone@example.com' });
    expect(res.status).toBe(401);
  });
});
