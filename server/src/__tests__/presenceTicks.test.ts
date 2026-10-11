import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';
import { groupMessageReceipt, isOnline, ONLINE_WINDOW_MS } from '../lib/presence';

// WhatsApp ticks (✓ sent, ✓✓ received, blue ✓✓ seen), "Seen by X of Y",
// "typing…", online / last seen, and the admin "online now" numbers.
const app = createApp();

let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.129.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) {
    wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', ip);
  }
  return wrapped;
}

let n = 0;
async function member(name: string, communityId?: string) {
  n += 1;
  const email = `pt${n}@example.com`;
  const person = await prisma.person.create({
    data: { name: `${name} ${n}`, whatsappNumber: `+2376555${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() },
  });
  await prisma.memberAccount.create({ data: { personId: person.id, email } });
  if (communityId) await prisma.communityMembership.create({ data: { personId: person.id, communityId, status: 'ACTIVE' } });
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/member/auth/request-code').set('X-CSRF-Token', csrf).send({ email });
  const code = spy.mock.calls[0][0].code as string;
  spy.mockRestore();
  await agent.post('/api/member/auth/verify-code').set('X-CSRF-Token', csrf).send({ email, code });
  return { agent, csrf, person };
}

type M = Awaited<ReturnType<typeof member>>;
const settle = () => new Promise((r) => setTimeout(r, 200));

describe('Tick rules (unit)', () => {
  const at = (s: number) => new Date(Date.UTC(2026, 9, 6, 10, 0, s));
  const audience = [
    { personId: 'me', name: 'Me', photoUrl: null, lastSeenAt: at(0) },
    { personId: 'a', name: 'A', photoUrl: null, lastSeenAt: at(0) },
    { personId: 'b', name: 'B', photoUrl: null, lastSeenAt: at(0) },
  ];
  const msg = { createdAt: at(10), senderPersonId: 'me' };

  it('✓ until everyone else has opened the app since', () => {
    const r = groupMessageReceipt(msg, [audience[0], { ...audience[1], lastSeenAt: at(20) }, audience[2]], new Map());
    expect(r.status).toBe('sent');
    expect(r.total).toBe(2);
    expect(r.deliveredTo.map((p) => p.personId)).toEqual(['a']);
  });

  it('✓✓ when everyone else received it, blue when everyone read it', () => {
    const all = audience.map((p) => ({ ...p, lastSeenAt: at(30) }));
    expect(groupMessageReceipt(msg, all, new Map([['a', at(40)]])).status).toBe('delivered');
    const read = groupMessageReceipt(msg, all, new Map([['a', at(40)], ['b', at(50)]]));
    expect(read.status).toBe('read');
    expect(read.readBy).toHaveLength(2);
  });

  it('online means active in the last ~75 seconds', () => {
    expect(isOnline(new Date(Date.now() - 10_000))).toBe(true);
    expect(isOnline(new Date(Date.now() - ONLINE_WINDOW_MS - 1000))).toBe(false);
    expect(isOnline(null)).toBe(false);
  });
});

describe('Group chat ticks, Seen by, typing and online count', () => {
  it('goes ✓ → ✓✓ → blue ✓✓ as the others open the app and the chat', async () => {
    const g = await prisma.community.create({ data: { name: 'Ticks Group' } });
    const ada = await member('Ada', g.id);
    const ben = await member('Ben', g.id);
    const cy = await member('Cy', g.id);
    const base = `/api/communities/${g.id}/conversation`;

    const sent = await ada.agent.post(`${base}/messages`).set('X-CSRF-Token', ada.csrf).send({ body: 'Prayer at 6pm' });
    expect(sent.status).toBe(201);
    const statusFor = async () => (await ada.agent.get(`${base}/messages`)).body.items.find((m: any) => m.id === sent.body.id).status;

    // Ben opens the chat and reads; Cy hasn't opened the app since.
    await ben.agent.get(`${base}/messages`);
    await ben.agent.post(`${base}/read`).set('X-CSRF-Token', ben.csrf).send({ messageId: sent.body.id });
    await settle();
    expect(await statusFor()).toBe('sent');

    const info = await ada.agent.get(`${base}/messages/${sent.body.id}/info`);
    expect(info.body.total).toBe(2);
    expect(info.body.readBy.map((p: any) => p.personId)).toEqual([ben.person.id]);

    // Cy opens the app (any page) — received, not yet seen.
    await cy.agent.get('/api/member/auth/ping');
    await settle();
    expect(await statusFor()).toBe('delivered');

    await cy.agent.post(`${base}/read`).set('X-CSRF-Token', cy.csrf).send({ messageId: sent.body.id });
    expect(await statusFor()).toBe('read');

    const list = await ada.agent.get(`${base}/messages`);
    expect(list.body.memberCount).toBe(3);
    expect(list.body.onlineCount).toBeGreaterThanOrEqual(1);
    // Other people's messages carry no ticks for the viewer.
    expect((await ben.agent.get(`${base}/messages`)).body.items[0].status).toBeUndefined();
  });

  it('only the sender can see Message info', async () => {
    const g = await prisma.community.create({ data: { name: 'Info Group' } });
    const ada = await member('Ada', g.id);
    const ben = await member('Ben', g.id);
    const base = `/api/communities/${g.id}/conversation`;
    const sent = await ada.agent.post(`${base}/messages`).set('X-CSRF-Token', ada.csrf).send({ body: 'Hi' });
    expect((await ben.agent.get(`${base}/messages/${sent.body.id}/info`)).status).toBe(403);
  });

  it('shows "typing…" to the others for a few seconds', async () => {
    const g = await prisma.community.create({ data: { name: 'Typing Group' } });
    const ada = await member('Ada', g.id);
    const ben = await member('Ben', g.id);
    const base = `/api/communities/${g.id}/conversation`;
    await ben.agent.post(`${base}/typing`).set('X-CSRF-Token', ben.csrf).send({ typing: true });
    expect((await ada.agent.get(`${base}/messages`)).body.typing).toEqual([ben.person.name]);
    expect((await ben.agent.get(`${base}/messages`)).body.typing).toEqual([]);
    await ben.agent.post(`${base}/typing`).set('X-CSRF-Token', ben.csrf).send({ typing: false });
    expect((await ada.agent.get(`${base}/messages`)).body.typing).toEqual([]);
  });
});

describe('Private chat ticks, online and typing', () => {
  async function friendsChat(a: M, b: M) {
    await prisma.friendship.create({ data: { requesterPersonId: a.person.id, addresseePersonId: b.person.id, status: 'ACCEPTED', respondedAt: new Date() } });
    const open = await a.agent.post('/api/member/messages/open').set('X-CSRF-Token', a.csrf).send({ personId: b.person.id });
    return `/api/private-messages/conversations/${open.body.conversationId}`;
  }

  it('✓ → ✓✓ → blue ✓✓, with online and typing for the other person', async () => {
    const ada = await member('Ada');
    const ben = await member('Ben');
    const base = await friendsChat(ada, ben);
    // Make sure Ben looks away before the message is sent.
    await prisma.person.update({ where: { id: ben.person.id }, data: { lastSeenAt: new Date(Date.now() - 60 * 60 * 1000) } });

    const sent = await ada.agent.post(`${base}/messages`).set('X-CSRF-Token', ada.csrf).send({ body: 'Hello Ben' });
    const view = async () => ada.agent.get(`${base}/messages`);
    let res = await view();
    expect(res.body.items.slice(-1)[0].status).toBe('sent');
    expect(res.body.otherPartyPresence.online).toBe(false);
    expect(res.body.otherPartyPresence.lastSeenAt).toBeTruthy();

    await ben.agent.get('/api/member/auth/ping');
    await settle();
    res = await view();
    expect(res.body.items.slice(-1)[0].status).toBe('delivered');
    expect(res.body.otherPartyPresence.online).toBe(true);

    await ben.agent.post(`${base}/read`).set('X-CSRF-Token', ben.csrf).send({ messageId: sent.body.id });
    expect((await view()).body.items.slice(-1)[0].status).toBe('read');

    const list = await ada.agent.get('/api/private-messages/conversations');
    expect(list.body.items[0].lastMessage.status).toBe('read');

    await ben.agent.post(`${base}/typing`).set('X-CSRF-Token', ben.csrf).send({ typing: true });
    expect((await view()).body.typing).toBe(true);
    expect((await ben.agent.get(`${base}/messages`)).body.typing).toBe(false);
  });
});

describe('Check-in and admin "online now"', () => {
  it('ping says whether you are signed in', async () => {
    const ada = await member('Ada');
    expect((await ada.agent.get('/api/member/auth/ping')).body).toEqual({ ok: true });
    expect((await request(app).get('/api/member/auth/ping')).body).toEqual({ ok: false });
  });

  it('admin sees how many are online, overall and per group', async () => {
    const g = await prisma.community.create({ data: { name: 'Online Group' } });
    const ada = await member('Ada', g.id);
    await member('Ben', g.id);
    await prisma.person.update({ where: { id: ada.person.id }, data: { lastSeenAt: new Date() } });

    await createAdmin('presence-admin@test.local', 'AdminPass123!');
    const admin = agentWithUniqueIp();
    const { csrf } = await bootstrap(admin as any);
    await admin.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: 'presence-admin@test.local', password: 'AdminPass123!' });

    const res = await admin.get('/api/admin/presence');
    expect(res.status).toBe(200);
    expect(res.body.onlineNow).toBeGreaterThanOrEqual(1);
    const row = res.body.groups.find((x: any) => x.communityId === g.id);
    expect(row).toMatchObject({ name: 'Online Group', memberCount: 2 });
    expect(row.onlineCount).toBeGreaterThanOrEqual(1);

    expect((await ada.agent.get('/api/admin/presence')).status).toBe(401);
  });
});
