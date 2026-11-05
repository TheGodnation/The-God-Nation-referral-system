import { describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { bootstrap } from './testUtils';

// Shared phone: a Leader's paired `sid` session must never survive into the next person's visit.
// (Founder tested with his wife's Leader account on his own phone and then saw HER dashboard.)
const app = createApp();

let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.122.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', ip);
  return wrapped;
}

let phoneCounter = 0;
async function makeMember(label: string, leader: boolean) {
  phoneCounter += 1;
  const email = `${label}-stale@test.local`;
  const person = await prisma.person.create({ data: { name: label, whatsappNumber: `+237672${String(400000 + phoneCounter).padStart(6, '0')}`, email } });
  await prisma.memberAccount.create({ data: { personId: person.id, email, passwordHash: bcrypt.hashSync('Testpass123', 10) } });
  const user = leader
    ? await prisma.user.create({ data: { name: label, email: `leader-${email}`, passwordHash: 'x', role: 'LEADER', active: true, personId: person.id } })
    : null;
  return { person, email, user };
}

async function signIn(agent: any, csrf: string, email: string) {
  const res = await agent.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'Testpass123' });
  expect(res.status).toBe(200);
}

describe('Leader session left on a shared device', () => {
  it('member sign-out also ends the paired Leader session', async () => {
    const wife = await makeMember('wife-one', true);
    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    await signIn(agent, csrf, wife.email);
    expect((await agent.get('/api/auth/me')).body.user?.id).toBe(wife.user!.id);

    const out = await agent.post('/api/member/auth/logout').set('X-CSRF-Token', csrf);
    expect(out.status).toBe(200);
    expect((await agent.get('/api/auth/me')).body.user).toBeFalsy();
  });

  it("signing in as someone else removes the previous person's Leader session", async () => {
    const wife = await makeMember('wife-two', true);
    const husband = await makeMember('husband-two', false);
    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    await signIn(agent, csrf, wife.email);
    expect((await agent.get('/api/auth/me')).body.user?.id).toBe(wife.user!.id);

    // No sign-out in between: the husband simply signs in on the same phone.
    await signIn(agent, csrf, husband.email);
    expect((await agent.get('/api/auth/me')).body.user).toBeFalsy();
    expect((await agent.get('/api/leader/dashboard')).status).toBe(401);
  });

  it("a Leader husband gets HIS own dashboard back after his wife's session", async () => {
    const wife = await makeMember('wife-three', true);
    const husband = await makeMember('husband-three', true);
    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    await signIn(agent, csrf, wife.email);
    await signIn(agent, csrf, husband.email);
    expect((await agent.get('/api/auth/me')).body.user?.id).toBe(husband.user!.id);
  });

  it("a stale Leader session from another person is dropped even if the member session was made another way", async () => {
    const wife = await makeMember('wife-four', true);
    const husband = await makeMember('husband-four', false);
    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    await signIn(agent, csrf, wife.email);
    // Wife's member cookie is replaced by the husband's, leaving only her leader cookie behind.
    await agent.post('/api/member/auth/logout').set('X-CSRF-Token', csrf);
    await signIn(agent, csrf, husband.email);
    expect((await agent.get('/api/auth/me')).body.user).toBeFalsy();
  });
});
