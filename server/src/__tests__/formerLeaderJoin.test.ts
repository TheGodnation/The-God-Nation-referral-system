import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';

// A leader from the first system joining the app as an ordinary newcomer: the
// join goes through (nothing rejects them), the admin sees a one-tap suggestion
// to link them, and linking carries their old referral code over.
const app = createApp();

let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.143.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) {
    wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', ip);
  }
  return wrapped;
}


async function admin(email: string) {
  await createAdmin(email, 'AdminPass123!');
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'AdminPass123!' });
  return { agent, csrf };
}

/** Joins through the public join flow (email + password, the emailed code, then details). */
async function join(email: string, whatsapp: string, password = 'NewPass12345') {
  const spy = vi.spyOn(EmailService, 'sendMemberSignupCode').mockResolvedValue({ ok: true });
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  const started = await agent.post('/api/member/auth/signup/start').set('X-CSRF-Token', csrf).send({ email, password, pathway: 'DISCOVER_GROW', language: 'en' });
  const code = spy.mock.calls[0]?.[0]?.code as string;
  spy.mockRestore();
  const finished = await agent
    .post('/api/member/auth/signup/finish')
    .set('X-CSRF-Token', csrf)
    .send({ email, code, whatsapp, name: 'Papa Former Leader', country: 'Cameroon', region: 'Littoral', division: 'Wouri', subdivision: 'Douala V', quarter: 'Bepanda' });
  return { started, finished, agent, csrf };
}

let phone = 0;
const freshPhone = () => `+237672${String(400000 + ++phone).padStart(6, '0')}`;

async function formerLeader(email: string) {
  const user = await prisma.user.create({ data: { name: 'Papa Former Leader', email, passwordHash: 'old-hash', role: 'LEADER', active: true } });
  const oldCode = await prisma.referralCode.create({ data: { code: `OLD${Math.floor(Math.random() * 1e6)}`, leaderId: user.id } });
  return { user, oldCode };
}

afterEach(() => vi.restoreAllMocks());

describe('A former leader joins as a newcomer', () => {
  it('goes through the normal join with the same email and a new password; nothing rejects them, and they are an ordinary member', async () => {
    const { user } = await formerLeader('former1@test.local');
    const { started, finished, agent } = await join('former1@test.local', freshPhone());
    expect(started.status).toBe(200);
    expect(finished.status).toBe(200);
    expect(await prisma.memberAccount.findUnique({ where: { email: 'former1@test.local' } })).not.toBeNull();
    // A member only: not paired with the old leader account until the admin links them.
    expect((await agent.get('/api/member/auth/me')).body.member).not.toBeNull();
    expect((await agent.get('/api/auth/me')).body.user).toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).personId).toBeNull();
  });

  it('shows the admin the member who joined with the same email (any capitals), and links them in one step', async () => {
    const { user, oldCode } = await formerLeader('Former2@Test.Local');
    const adminA = await admin('admin-former2@test.local');
    const whatsapp = freshPhone();
    await join('former2@test.local', whatsapp);
    const person = await prisma.person.findUniqueOrThrow({ where: { whatsappNumber: whatsapp }, include: { memberAccount: true } });

    const list = await adminA.agent.get('/api/admin/leaders');
    const row = list.body.items.find((l: any) => l.id === user.id);
    expect(row.suggestedPerson).toEqual({ id: person.id, name: 'Papa Former Leader', whatsappNumber: whatsapp });

    const link = await adminA.agent.patch(`/api/admin/leaders/${user.id}/link-person`).set('X-CSRF-Token', adminA.csrf).send({ personId: person.id });
    expect(link.status).toBe(200);
    // No suggestion once linked.
    const after = await adminA.agent.get('/api/admin/leaders');
    expect(after.body.items.find((l: any) => l.id === user.id)).toMatchObject({ suggestedPerson: null, personId: person.id });

    // The old code now belongs to the profile (every old link keeps working and credits them); the empty new one is gone.
    const codes = await prisma.referralCode.findMany({ where: { OR: [{ personId: person.id }, { leaderId: user.id }] } });
    expect(codes).toHaveLength(1);
    expect(codes[0]).toMatchObject({ id: oldCode.id, personId: person.id, leaderId: user.id });

    // Signing in as a member now brings the leader account with it.
    const again = agentWithUniqueIp();
    const { csrf } = await bootstrap(again as any);
    expect((await again.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email: 'former2@test.local', password: 'NewPass12345' })).status).toBe(200);
    const me = await again.get('/api/auth/me');
    expect(me.body.user).toMatchObject({ id: user.id, role: 'LEADER' });
  });

  it('keeps the new code when it has already been used, and still attaches the leader to it', async () => {
    const { user } = await formerLeader('former3@test.local');
    const adminA = await admin('admin-former3@test.local');
    const whatsapp = freshPhone();
    await join('former3@test.local', whatsapp);
    const person = await prisma.person.findUniqueOrThrow({ where: { whatsappNumber: whatsapp } });
    const own = await prisma.referralCode.findUniqueOrThrow({ where: { personId: person.id } });
    await prisma.referralVisit.create({ data: { visitorId: 'v-used', referralCodeId: own.id } as never });
    await adminA.agent.patch(`/api/admin/leaders/${user.id}/link-person`).set('X-CSRF-Token', adminA.csrf).send({ personId: person.id });
    expect(await prisma.referralCode.findUniqueOrThrow({ where: { id: own.id } })).toMatchObject({ personId: person.id, leaderId: user.id });
  });

  it('suggests nobody when no member has joined with that email', async () => {
    const { user } = await formerLeader('former4@test.local');
    const adminA = await admin('admin-former4@test.local');
    const list = await adminA.agent.get('/api/admin/leaders');
    expect(list.body.items.find((l: any) => l.id === user.id).suggestedPerson).toBeNull();
  });
});

describe('Member emails carry only a code', () => {
  it('the forgot-password email gives the 6-digit code and no link', async () => {
    const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
    const person = await prisma.person.create({ data: { name: 'Code Only', whatsappNumber: freshPhone(), email: 'codeonly@test.local' } });
    await prisma.memberAccount.create({ data: { personId: person.id, email: 'codeonly@test.local', passwordHash: 'h' } });
    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    expect((await agent.post('/api/member/auth/request-code').set('X-CSRF-Token', csrf).send({ email: 'codeonly@test.local' })).status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].code).toMatch(/^\d{6}$/);
    // The wording of the email itself (what the member reads) has no link in it.
    const { renderMemberCodeEmailForTest } = await import('../lib/email');
    const text = renderMemberCodeEmailForTest('en');
    expect(text).toContain('{{code}}');
    expect(text).not.toContain('{{link}}');
    expect(renderMemberCodeEmailForTest('fr')).not.toContain('{{link}}');
  });
});
