import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createAdmin, createLeader } from './helpers';
import { bootstrap } from './testUtils';

// Admin → Sign-in trouble: who tried to sign in or join and is still stuck.
const app = createApp();

async function adminAgent() {
  await createAdmin('trouble-admin@test.local', 'AdminPass123!');
  const agent = request.agent(app);
  const { csrf } = await bootstrap(agent);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: 'trouble-admin@test.local', password: 'AdminPass123!' });
  return agent;
}

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);

describe('Sign-in trouble', () => {
  it('lists leaders and members still stuck, and unfinished sign-ups — not those who got in since', async () => {
    const agent = await adminAgent();

    // A leader with wrong passwords, never in since.
    const { user: stuckLeader } = await createLeader('Stuck Leader', 'stuck@gmial.com', 'STUCK1');
    await prisma.loginAttempt.createMany({
      data: [
        { identifier: 'stuck@gmial.com', success: false, createdAt: ago(30) },
        { identifier: 'stuck@gmial.com', success: false, createdAt: ago(20) },
      ],
    });
    // A leader who got it right afterwards.
    await createLeader('Fine Leader', 'fine@test.local', 'FINE1');
    await prisma.loginAttempt.createMany({
      data: [
        { identifier: 'fine@test.local', success: false, createdAt: ago(30) },
        { identifier: 'fine@test.local', success: true, createdAt: ago(25) },
      ],
    });
    // A leader-page email nobody has (often a misspelling).
    await prisma.loginAttempt.create({ data: { identifier: 'nobody@yahooo.fr', success: false, createdAt: ago(10) } });

    // A member with a wrong password, and one with a wrong code who then got in.
    const person = await prisma.person.create({ data: { name: 'Stuck Member', whatsappNumber: '+237670888001' } });
    await prisma.memberAccount.create({ data: { personId: person.id, email: 'member@example.com' } });
    await prisma.loginAttempt.create({ data: { identifier: 'member:member@example.com', success: false, createdAt: ago(5) } });
    const okPerson = await prisma.person.create({ data: { name: 'Got In', whatsappNumber: '+237670888002' } });
    const okAccount = await prisma.memberAccount.create({ data: { personId: okPerson.id, email: 'gotin@example.com', lastLoginAt: ago(1) } });
    await prisma.auditLog.create({ data: { action: 'MEMBER_LOGIN_CODE_WRONG', targetType: 'MemberAccount', targetId: okAccount.id, createdAt: ago(3) } });

    // Someone who started joining and never finished.
    await prisma.pendingMemberSignup.create({
      data: { email: 'joiner@example.com', passwordHash: 'x', pathway: 'TRAINING', visitorId: 'v1', codeHash: 'x', codeAttempts: 2, expiresAt: new Date(Date.now() + 10 * 60_000) },
    });

    const res = await agent.get('/api/admin/sign-in-trouble?days=30');
    expect(res.status).toBe(200);
    const byEmail = Object.fromEntries(res.body.items.map((i: any) => [i.email, i]));
    expect(Object.keys(byEmail).sort()).toEqual(['joiner@example.com', 'member@example.com', 'nobody@yahooo.fr', 'stuck@gmial.com']);

    expect(byEmail['stuck@gmial.com']).toMatchObject({ kind: 'LEADER_SIGN_IN', failedTries: 2, hasAccount: true, leaderId: stuckLeader.id, name: 'Stuck Leader' });
    expect(byEmail['nobody@yahooo.fr']).toMatchObject({ kind: 'LEADER_SIGN_IN', hasAccount: false, leaderId: null });
    expect(byEmail['member@example.com']).toMatchObject({ kind: 'MEMBER_SIGN_IN', name: 'Stuck Member', whatsappNumber: '+237670888001', personId: person.id });
    expect(byEmail['joiner@example.com']).toMatchObject({ kind: 'UNFINISHED_SIGNUP', failedTries: 2, hasAccount: false });
    // Newest first.
    expect(res.body.items[0].email).toBe('member@example.com');
  });

  it('only looks back as far as asked', async () => {
    const agent = await adminAgent();
    await prisma.loginAttempt.create({ data: { identifier: 'old@example.com', success: false, createdAt: ago(60 * 24 * 10) } });
    expect((await agent.get('/api/admin/sign-in-trouble?days=7')).body.items).toEqual([]);
    expect((await agent.get('/api/admin/sign-in-trouble?days=30')).body.items).toHaveLength(1);
  });

  it('is for the central admin only', async () => {
    const res = await request(app).get('/api/admin/sign-in-trouble');
    expect(res.status).toBe(401);
  });
});
