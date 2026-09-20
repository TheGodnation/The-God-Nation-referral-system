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

async function register(whatsapp: string, name = 'Test Person') {
  const agent = request.agent(app);
  const { csrf } = await bootstrap(agent);
  return agent
    .post('/api/registrations')
    .set('X-CSRF-Token', csrf)
    .send({ name, whatsapp, language: 'en', pathway: 'TRAINING' });
}

describe('Acceptance Test — admin deletes a registration to free its WhatsApp number', () => {
  it('lets Admin permanently delete a registration, freeing its number for reuse', async () => {
    await createAdmin('admin@test.local', 'AdminPass123!');
    const whatsapp = '+237670000090';

    const first = await register(whatsapp, 'First Attempt');
    expect(first.status).toBe(201);
    const registrationId = first.body.registrationId;

    // Confirm the number is genuinely blocked before any deletion.
    const duplicate = await register(whatsapp, 'Duplicate Attempt');
    expect(duplicate.status).toBe(409);

    const { agent: adminAgent, csrf: adminCsrf } = await loginAs('admin@test.local', 'AdminPass123!');

    // A non-existent id must 404, not silently succeed.
    const missing = await adminAgent
      .delete('/api/admin/registrations/00000000-0000-0000-0000-000000000000')
      .set('X-CSRF-Token', adminCsrf);
    expect(missing.status).toBe(404);

    const del = await adminAgent.delete(`/api/admin/registrations/${registrationId}`).set('X-CSRF-Token', adminCsrf);
    expect(del.status).toBe(200);
    expect(del.body.ok).toBe(true);

    const stillThere = await prisma.registration.findUnique({ where: { id: registrationId } });
    expect(stillThere).toBeNull();

    // The freed number must now be accepted as a brand-new registration.
    const again = await register(whatsapp, 'Second Attempt');
    expect(again.status).toBe(201);
    expect(again.body.registrationId).not.toBe(registrationId);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'REGISTRATION_DELETED', targetId: registrationId },
    });
    expect(audit).not.toBeNull();
    expect((audit!.metadata as any).whatsapp).toBe(whatsapp);
  });

  it('never lets a Leader delete a registration', async () => {
    await createLeader('Mary Ngu', 'mary@example.com', 'MARY7X2');
    const reg = await register('+237670000091', 'Someone');
    expect(reg.status).toBe(201);

    const { agent } = await loginAs('mary@example.com', 'password123');
    const res = await agent.delete(`/api/admin/registrations/${reg.body.registrationId}`);
    expect(res.status).toBe(403);

    const stillThere = await prisma.registration.findUnique({ where: { id: reg.body.registrationId } });
    expect(stillThere).not.toBeNull();
  });
});
