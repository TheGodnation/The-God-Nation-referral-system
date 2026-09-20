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

describe('Acceptance Test — Admin deletes a Leader account', () => {
  it('permanently removes a Leader with no referrals yet (e.g. an accidental duplicate signup)', async () => {
    await createAdmin('admin-del@test.local', 'AdminPass123!');
    const { user: leader } = await createLeader('Duplicate Grace', 'grace-dup@example.com', 'GRACEDUP1');

    const { agent, csrf } = await loginAs('admin-del@test.local', 'AdminPass123!');

    const missing = await agent
      .delete('/api/admin/leaders/00000000-0000-0000-0000-000000000000')
      .set('X-CSRF-Token', csrf);
    expect(missing.status).toBe(404);

    const del = await agent.delete(`/api/admin/leaders/${leader.id}`).set('X-CSRF-Token', csrf);
    expect(del.status).toBe(200);
    expect(del.body.ok).toBe(true);

    const stillThere = await prisma.user.findUnique({ where: { id: leader.id } });
    expect(stillThere).toBeNull();
    const codeStillThere = await prisma.referralCode.findUnique({ where: { code: 'GRACEDUP1' } });
    expect(codeStillThere).toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'LEADER_DELETED', targetId: leader.id },
    });
    expect(audit).not.toBeNull();
    expect((audit!.metadata as any).email).toBe('grace-dup@example.com');
    expect((audit!.metadata as any).referredCount).toBe(0);
  });

  it('deleting a Leader with existing referrals keeps those registrations, just unlinked', async () => {
    await createAdmin('admin-del2@test.local', 'AdminPass123!');
    const { user: leader, referralCode } = await createLeader('Referring John', 'john-ref@example.com', 'JOHNREF1');

    // Attribute a real registration to this leader via a referral visit.
    const visitorAgent = request.agent(app);
    const { csrf: visitCsrf } = await bootstrap(visitorAgent);
    await visitorAgent
      .post('/api/referrals/visit')
      .set('X-CSRF-Token', visitCsrf)
      .send({ ref: referralCode.code, lang: 'en' });
    const reg = await visitorAgent
      .post('/api/registrations')
      .set('X-CSRF-Token', visitCsrf)
      .send({ name: 'Referred Person', whatsapp: '+237670000099', language: 'en', pathway: 'TRAINING' });
    expect(reg.status).toBe(201);
    const registrationId = reg.body.registrationId;

    const relationshipBefore = await prisma.referralRelationship.findUnique({ where: { registrationId } });
    expect(relationshipBefore?.leaderId).toBe(leader.id);

    const { agent, csrf } = await loginAs('admin-del2@test.local', 'AdminPass123!');
    const del = await agent.delete(`/api/admin/leaders/${leader.id}`).set('X-CSRF-Token', csrf);
    expect(del.status).toBe(200);

    // The registration itself must survive — only the leader link is gone.
    const registration = await prisma.registration.findUnique({ where: { id: registrationId } });
    expect(registration).not.toBeNull();
    const relationshipAfter = await prisma.referralRelationship.findUnique({ where: { registrationId } });
    expect(relationshipAfter).toBeNull();

    const audit = await prisma.auditLog.findFirst({ where: { action: 'LEADER_DELETED', targetId: leader.id } });
    expect((audit!.metadata as any).referredCount).toBe(1);
  });

  it('never lets a Leader delete another account, and refuses to delete an Admin', async () => {
    const admin = await createAdmin('admin-del3@test.local', 'AdminPass123!');
    const { user: leaderA } = await createLeader('Leader A', 'leader-a@example.com', 'LEADERA1');
    const { user: leaderB } = await createLeader('Leader B', 'leader-b@example.com', 'LEADERB1');

    const { agent: leaderAgent } = await loginAs('leader-a@example.com', 'password123');
    const forbidden = await leaderAgent.delete(`/api/admin/leaders/${leaderB.id}`);
    expect(forbidden.status).toBe(403);
    expect(await prisma.user.findUnique({ where: { id: leaderB.id } })).not.toBeNull();

    const { agent: adminAgent, csrf } = await loginAs('admin-del3@test.local', 'AdminPass123!');
    const adminTargeted = await adminAgent.delete(`/api/admin/leaders/${admin.id}`).set('X-CSRF-Token', csrf);
    expect(adminTargeted.status).toBe(404);
    expect(await prisma.user.findUnique({ where: { id: admin.id } })).not.toBeNull();
  });
});
