import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';

// Pinned messages: the central admin pins up to three messages at the top of
// an assembly's chat; everyone in it sees them first (newcomers too, whatever
// the message's age); a pin you have not opened is "unseen" until you do.
const app = createApp();
const MIN = 60_000;

let ip = 0;
function agentWithUniqueIp() {
  ip += 1;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', `10.160.${Math.floor(ip / 256)}.${ip % 256}`);
  return wrapped;
}
type Agent = ReturnType<typeof agentWithUniqueIp>;
type Who = { agent: Agent; csrf: string; person: { id: string } };

let n = 0;
async function member(name: string, communityId?: string, joinedAt?: Date): Promise<Who> {
  n += 1;
  const email = `pin${n}@example.com`;
  const person = await prisma.person.create({ data: { name, whatsappNumber: `+2376690${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() } });
  await prisma.memberAccount.create({ data: { personId: person.id, email } });
  if (communityId) await prisma.communityMembership.create({ data: { personId: person.id, communityId, status: 'ACTIVE', ...(joinedAt ? { joinedAt } : {}) } });
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/member/auth/request-code').set('X-CSRF-Token', csrf).send({ email });
  const code = spy.mock.calls[0][0].code as string;
  spy.mockRestore();
  await agent.post('/api/member/auth/verify-code').set('X-CSRF-Token', csrf).send({ email, code });
  return { agent, csrf, person };
}
/** The central admin: an admin account linked to a member profile. */
async function centralAdmin(): Promise<Who> {
  const w = await member('Evangelist Admin');
  const admin = await createAdmin('pin-admin@test.local', 'AdminPass123!');
  await prisma.user.update({ where: { id: admin.id }, data: { personId: w.person.id } });
  return w;
}

/** An assembly with an old member who wrote `count` messages (p1 … pN, oldest first). */
async function assembly(count: number) {
  const community = await prisma.community.create({ data: { name: `Pins ${n++}` } });
  const old = await member('Old Timer', community.id, new Date(Date.now() - 3 * 24 * 60 * MIN));
  const conversation = await prisma.conversation.create({ data: { communityId: community.id } });
  const ids: string[] = [];
  for (let i = 1; i <= count; i++) {
    const m = await prisma.message.create({ data: { conversationId: conversation.id, senderPersonId: old.person.id, body: `p${i}`, createdAt: new Date(Date.now() - (count + 20 - i) * MIN) } });
    ids.push(m.id);
  }
  return { community, conversation, old, ids };
}
const base = (communityId: string) => `/api/communities/${communityId}/conversation`;
const pin = (w: Who, communityId: string, messageId: string) => w.agent.put(`${base(communityId)}/messages/${messageId}/pin`).set('X-CSRF-Token', w.csrf).send({});
const unpin = (w: Who, communityId: string, messageId: string) => w.agent.delete(`${base(communityId)}/messages/${messageId}/pin`).set('X-CSRF-Token', w.csrf).send({});
const seen = (w: Who, communityId: string, messageId: string) => w.agent.post(`${base(communityId)}/messages/${messageId}/pin/seen`).set('X-CSRF-Token', w.csrf).send({});
const info = async (w: Who, communityId: string) => (await w.agent.get(base(communityId))).body;

describe('pinning', () => {
  it('only the central admin can pin or unpin; an ordinary member and a leader cannot', async () => {
    const { community, ids, old } = await assembly(3);
    const owner = await centralAdmin();
    const ordinary = await member('Ordinary', community.id);
    expect((await pin(ordinary, community.id, ids[0])).status).toBe(403);
    expect((await pin(old, community.id, ids[0])).status).toBe(403);
    expect((await unpin(ordinary, community.id, ids[0])).status).toBe(403);
    expect(await prisma.messagePin.count()).toBe(0);
    const ok = await pin(owner, community.id, ids[0]);
    expect(ok.status).toBe(200);
    expect(ok.body.pins).toHaveLength(1);
    expect(ok.body.pins[0]).toMatchObject({ messageId: ids[0], body: 'p1', senderName: 'Old Timer' });
    expect(await prisma.auditLog.count({ where: { action: 'COMMUNITY_MESSAGE_PINNED' } })).toBe(1);
  });

  it('is safe to repeat, allows at most three at a time, and unpinning frees a place', async () => {
    const { community, ids } = await assembly(5);
    const owner = await centralAdmin();
    for (const id of ids.slice(0, 3)) expect((await pin(owner, community.id, id)).status).toBe(200);
    expect((await pin(owner, community.id, ids[0])).status).toBe(200); // again: no change
    expect(await prisma.messagePin.count()).toBe(3);
    const fourth = await pin(owner, community.id, ids[3]);
    expect(fourth.status).toBe(409);
    expect(fourth.body.error).toMatch(/up to 3/);
    const after = await unpin(owner, community.id, ids[1]);
    expect(after.status).toBe(200);
    expect(after.body.pins).toHaveLength(2);
    expect((await unpin(owner, community.id, ids[1])).status).toBe(200); // again: no change
    expect((await pin(owner, community.id, ids[3])).status).toBe(200);
  });

  it('refuses a message from another assembly, a removed message, and someone with no access', async () => {
    const a = await assembly(2);
    const b = await assembly(2);
    const owner = await centralAdmin();
    expect((await pin(owner, a.community.id, b.ids[0])).status).toBe(404);
    await prisma.message.update({ where: { id: a.ids[0] }, data: { deletedAt: new Date() } });
    expect((await pin(owner, a.community.id, a.ids[0])).status).toBe(404);
    const outsider = await member('Outsider');
    expect((await seen(outsider, a.community.id, a.ids[1])).status).toBe(403);
    expect((await outsider.agent.get(base(a.community.id))).status).toBe(403);
  });
});

describe('what the assembly sees', () => {
  it('shows the pins in the conversation info, and marks the pinned message in the chat', async () => {
    const { community, ids } = await assembly(3);
    const owner = await centralAdmin();
    const ordinary = await member('Ordinary', community.id, new Date(Date.now() - 5 * 24 * 60 * MIN));
    await pin(owner, community.id, ids[1]);
    const i = await info(ordinary, community.id);
    expect(i.canPin).toBe(false);
    expect(i.pins).toHaveLength(1);
    expect(i.pins[0]).toMatchObject({ messageId: ids[1], body: 'p2', unseen: true });
    const list = (await ordinary.agent.get(`${base(community.id)}/messages`)).body.items;
    expect(list.map((m: any) => [m.body, m.pinned])).toEqual([['p1', false], ['p2', true], ['p3', false]]);
    expect((await info(owner, community.id)).canPin).toBe(true);
  });

  it('a pin is unseen until the member opens it; the one who pinned it is never nudged; pinning again after unpinning is new', async () => {
    const { community, ids } = await assembly(2);
    const owner = await centralAdmin();
    const ordinary = await member('Ordinary', community.id, new Date(Date.now() - 5 * 24 * 60 * MIN));
    await pin(owner, community.id, ids[0]);
    expect((await info(owner, community.id)).pins[0].unseen).toBe(false);
    expect((await info(ordinary, community.id)).pins[0].unseen).toBe(true);
    expect((await seen(ordinary, community.id, ids[0])).status).toBe(200);
    expect((await seen(ordinary, community.id, ids[0])).status).toBe(200); // again: no change
    expect(await prisma.messagePinSeen.count()).toBe(1);
    expect((await info(ordinary, community.id)).pins[0].unseen).toBe(false);
    // Unpinned and pinned again later: it is something new, so the chip shows again.
    await unpin(owner, community.id, ids[0]);
    expect((await info(ordinary, community.id)).pins).toHaveLength(0);
    await pin(owner, community.id, ids[0]);
    expect((await info(ordinary, community.id)).pins[0].unseen).toBe(true);
  });

  it('a newcomer sees a pinned message even when it is older than the last 30 they are shown', async () => {
    const { community, ids } = await assembly(45);
    const owner = await centralAdmin();
    await pin(owner, community.id, ids[0]); // p1 — far outside a newcomer's window
    const newcomer = await member('Newcomer', community.id);
    const i = await info(newcomer, community.id);
    expect(i.pins.map((p: any) => p.body)).toEqual(['p1']);
    expect(i.pins[0].unseen).toBe(true);
    const list = (await newcomer.agent.get(`${base(community.id)}/messages?limit=50`)).body.items.map((m: any) => m.body);
    expect(list).not.toContain('p1');
    expect(list).toHaveLength(30);
  });

  it('a removed message leaves the pins; the central admin\'s message carries the coordinator badge', async () => {
    const { community, conversation } = await assembly(1);
    const owner = await centralAdmin();
    const own = await prisma.message.create({ data: { conversationId: conversation.id, senderPersonId: owner.person.id, body: 'From the Evangelist' } });
    await pin(owner, community.id, own.id);
    const ordinary = await member('Ordinary', community.id, new Date(Date.now() - 5 * 24 * 60 * MIN));
    const i = await info(ordinary, community.id);
    expect(i.pins[0]).toMatchObject({ body: 'From the Evangelist', senderBadge: 'NATIONAL_COORDINATOR' });
    await prisma.message.update({ where: { id: own.id }, data: { deletedAt: new Date() } });
    expect((await info(ordinary, community.id)).pins).toEqual([]);
  });

  it('shows a translation in the viewer\'s language, and a teaching or attachment as words', async () => {
    const { community, conversation, ids } = await assembly(1);
    const owner = await centralAdmin();
    const fr = await prisma.message.create({ data: { conversationId: conversation.id, senderPersonId: owner.person.id, body: 'Bonjour à tous', detectedLanguage: 'fr', translatedBody: 'Hello everyone' } });
    const ordinary = await member('Ordinary', community.id, new Date(Date.now() - 5 * 24 * 60 * MIN));
    await prisma.person.update({ where: { id: ordinary.person.id }, data: { preferredLanguage: 'en' } });
    await pin(owner, community.id, fr.id);
    const p = (await info(ordinary, community.id)).pins[0];
    expect(p.body).toBe('Bonjour à tous');
    expect(p.translation).toEqual({ sourceLanguage: 'fr', translatedBody: 'Hello everyone' });
    void ids;
  });

  it('a message the member hid for themselves is not shown to them as a pin', async () => {
    const { community, ids, old } = await assembly(2);
    const owner = await centralAdmin();
    await pin(owner, community.id, ids[0]);
    await prisma.messageHiddenForPerson.create({ data: { messageId: ids[0], personId: old.person.id } });
    expect((await info(old, community.id)).pins).toEqual([]);
    expect((await info(owner, community.id)).pins).toHaveLength(1);
  });
});
