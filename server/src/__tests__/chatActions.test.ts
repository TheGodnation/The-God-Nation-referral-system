import crypto from 'crypto';
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

vi.mock('../lib/storage', () => ({
  isStorageConfigured: vi.fn(() => true),
  createUploadUrl: vi.fn(async ({ storageKey }: { storageKey: string }) => ({
    url: `https://mock-r2.example/upload/${storageKey}`,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  })),
  createDownloadUrl: vi.fn(async ({ storageKey }: { storageKey: string }) => ({
    url: `https://mock-r2.example/download/${storageKey}`,
    expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
  })),
  headObject: vi.fn(async () => null),
  copyObject: vi.fn(async () => undefined),
}));

import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import * as storage from '../lib/storage';
import { bootstrap } from './testUtils';

// WhatsApp actions: delete for everyone, edit, search, mute, forward.
const app = createApp();

let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.133.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
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
  const email = `ca${n}@example.com`;
  const person = await prisma.person.create({
    data: { name: `${name} ${n}`, whatsappNumber: `+2376557${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() },
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

const g = (id: string) => `/api/communities/${id}/conversation`;

async function say(m: M, communityId: string, body: string) {
  const res = await m.agent.post(`${g(communityId)}/messages`).set('X-CSRF-Token', m.csrf).send({ body });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function listFor(m: M, communityId: string) {
  return (await m.agent.get(`${g(communityId)}/messages`)).body.items as any[];
}

async function privateChat(a: M, b: M) {
  await prisma.friendship.create({ data: { requesterPersonId: a.person.id, addresseePersonId: b.person.id, status: 'ACCEPTED', respondedAt: new Date() } });
  const res = await a.agent.post('/api/member/messages/open').set('X-CSRF-Token', a.csrf).send({ personId: b.person.id });
  return res.body.conversationId as string;
}

const p = (id: string) => `/api/private-messages/conversations/${id}`;

describe('Group: delete for everyone', () => {
  it('the sender deletes their own message; everyone sees "deleted", nothing else', async () => {
    const c = await prisma.community.create({ data: { name: 'Unsend Group' } });
    const ada = await member('Ada', c.id);
    const ben = await member('Ben', c.id);
    const id = await say(ada, c.id, 'Oops wrong group');
    await ben.agent.put(`${g(c.id)}/messages/${id}/reaction`).set('X-CSRF-Token', ben.csrf).send({ emoji: '🙏' });

    // Someone else cannot delete it for everyone.
    expect((await ben.agent.post(`${g(c.id)}/messages/${id}/unsend`).set('X-CSRF-Token', ben.csrf)).status).toBe(403);

    const res = await ada.agent.post(`${g(c.id)}/messages/${id}/unsend`).set('X-CSRF-Token', ada.csrf);
    expect(res.status).toBe(200);
    const seen = (await listFor(ben, c.id)).find((m) => m.id === id);
    expect(seen).toMatchObject({ deleted: true, deletedBySender: true, body: null, attachments: [], reactions: [] });
    const meta = await ben.agent.get(g(c.id));
    expect(meta.body.lastMessage).toMatchObject({ deleted: true, deletedBySender: true, body: null });
    // The text is kept for oversight only.
    expect((await prisma.message.findUnique({ where: { id } }))?.body).toBe('Oops wrong group');
  });

  it('is refused after 2 days', async () => {
    const c = await prisma.community.create({ data: { name: 'Old Group' } });
    const ada = await member('Ada', c.id);
    const id = await say(ada, c.id, 'Long ago');
    await prisma.message.update({ where: { id }, data: { createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) } });
    expect((await ada.agent.post(`${g(c.id)}/messages/${id}/unsend`).set('X-CSRF-Token', ada.csrf)).status).toBe(400);
  });
});

describe('Group: edit', () => {
  it('the sender edits within 15 minutes; others see the new text with "edited"', async () => {
    const c = await prisma.community.create({ data: { name: 'Edit Group' } });
    const ada = await member('Ada', c.id);
    const ben = await member('Ben', c.id);
    const id = await say(ada, c.id, 'Meeting at 5');
    const benFirst = await listFor(ben, c.id);

    expect((await ben.agent.patch(`${g(c.id)}/messages/${id}`).set('X-CSRF-Token', ben.csrf).send({ body: 'hack' })).status).toBe(403);
    const res = await ada.agent.patch(`${g(c.id)}/messages/${id}`).set('X-CSRF-Token', ada.csrf).send({ body: 'Meeting at 6' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ body: 'Meeting at 6', edited: true });

    expect((await listFor(ben, c.id)).find((m) => m.id === id)).toMatchObject({ body: 'Meeting at 6', edited: true });
    // Light polling also carries the new text.
    const poll = await ben.agent.get(`${g(c.id)}/messages?after=${benFirst[benFirst.length - 1].id}`);
    expect(poll.body.recent.find((r: any) => r.id === id)).toMatchObject({ edited: true, body: 'Meeting at 6' });

    expect((await ada.agent.patch(`${g(c.id)}/messages/${id}`).set('X-CSRF-Token', ada.csrf).send({ body: '   ' })).status).toBe(400);
    await prisma.message.update({ where: { id }, data: { createdAt: new Date(Date.now() - 20 * 60 * 1000) } });
    expect((await ada.agent.patch(`${g(c.id)}/messages/${id}`).set('X-CSRF-Token', ada.csrf).send({ body: 'Too late' })).status).toBe(400);
  });
});

describe('Group: search and mute', () => {
  it('finds messages by a word, never removed ones, and only for members', async () => {
    const c = await prisma.community.create({ data: { name: 'Search Group' } });
    const ada = await member('Ada', c.id);
    await say(ada, c.id, 'Prayer meeting on Friday');
    await say(ada, c.id, 'Bring your Bible');
    const gone = await say(ada, c.id, 'Secret prayer list');
    await ada.agent.post(`${g(c.id)}/messages/${gone}/unsend`).set('X-CSRF-Token', ada.csrf);

    const res = await ada.agent.get(`${g(c.id)}/search?q=PRAYER`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: any) => i.body)).toEqual(['Prayer meeting on Friday']);
    expect((await ada.agent.get(`${g(c.id)}/search?q=a`)).status).toBe(400);

    const outsider = await member('Out');
    expect((await outsider.agent.get(`${g(c.id)}/search?q=prayer`)).status).toBe(403);
  });

  it('mutes for 8 hours, always, and unmutes — only for the person who chose it', async () => {
    const c = await prisma.community.create({ data: { name: 'Mute Group' } });
    const ada = await member('Ada', c.id);
    const ben = await member('Ben', c.id);

    const muted = await ada.agent.put(`${g(c.id)}/mute`).set('X-CSRF-Token', ada.csrf).send({ for: '8h' });
    expect(muted.status).toBe(200);
    const meta = await ada.agent.get(g(c.id));
    expect(meta.body.muted).toBe(true);
    expect(new Date(meta.body.mutedUntil).getTime()).toBeGreaterThan(Date.now() + 7 * 60 * 60 * 1000);
    expect((await ben.agent.get(g(c.id))).body.muted).toBe(false);

    await ada.agent.put(`${g(c.id)}/mute`).set('X-CSRF-Token', ada.csrf).send({ for: 'always' });
    expect((await ada.agent.get(g(c.id))).body).toMatchObject({ muted: true, mutedUntil: null });

    // An expired mute counts as not muted.
    await prisma.groupChatMute.update({
      where: { personId_communityId: { personId: ada.person.id, communityId: c.id } },
      data: { until: new Date(Date.now() - 1000) },
    });
    expect((await ada.agent.get(g(c.id))).body.muted).toBe(false);

    await ada.agent.delete(`${g(c.id)}/mute`).set('X-CSRF-Token', ada.csrf);
    expect(await prisma.groupChatMute.count({ where: { personId: ada.person.id } })).toBe(0);
    expect((await ada.agent.put(`${g(c.id)}/mute`).set('X-CSRF-Token', ada.csrf).send({ for: 'forever' })).status).toBe(400);
  });
});

describe('Private chat: delete for everyone, edit, search', () => {
  it('works like WhatsApp for the sender only', async () => {
    const ada = await member('Ada');
    const ben = await member('Ben');
    const conv = await privateChat(ada, ben);
    const sent = await ada.agent.post(`${p(conv)}/messages`).set('X-CSRF-Token', ada.csrf).send({ body: 'Hello Ben, see you Sunday' });
    const id = sent.body.id as string;

    expect((await ben.agent.patch(`${p(conv)}/messages/${id}`).set('X-CSRF-Token', ben.csrf).send({ body: 'x' })).status).toBe(403);
    expect((await ada.agent.patch(`${p(conv)}/messages/${id}`).set('X-CSRF-Token', ada.csrf).send({ body: 'Hello Ben, see you Saturday' })).status).toBe(200);
    let item = (await ben.agent.get(`${p(conv)}/messages`)).body.items.find((m: any) => m.id === id);
    expect(item).toMatchObject({ body: 'Hello Ben, see you Saturday', edited: true, deleted: false });

    const found = await ben.agent.get(`${p(conv)}/search?q=saturday`);
    expect(found.body.items).toHaveLength(1);
    expect(found.body.items[0]).toMatchObject({ id, isOwn: false });

    expect((await ben.agent.post(`${p(conv)}/messages/${id}/unsend`).set('X-CSRF-Token', ben.csrf)).status).toBe(403);
    expect((await ada.agent.post(`${p(conv)}/messages/${id}/unsend`).set('X-CSRF-Token', ada.csrf)).status).toBe(200);
    item = (await ben.agent.get(`${p(conv)}/messages`)).body.items.find((m: any) => m.id === id);
    expect(item).toMatchObject({ deleted: true, body: null, attachments: [], reactions: [] });
    expect((await ben.agent.get(`${p(conv)}/search?q=saturday`)).body.items).toHaveLength(0);
    expect((await ben.agent.put(`${p(conv)}/messages/${id}/reaction`).set('X-CSRF-Token', ben.csrf).send({ emoji: '👍' })).status).toBe(404);

    const list = await ben.agent.get('/api/private-messages/conversations');
    expect(list.body.items.find((c: any) => c.id === conv).lastMessage).toMatchObject({ deleted: true, body: null });
  });
});

describe('Forward', () => {
  it('copies a group message with its photo to another group and a private chat, marked forwarded', async () => {
    const g1 = await prisma.community.create({ data: { name: 'From Group' } });
    const g2 = await prisma.community.create({ data: { name: 'To Group' } });
    const ada = await member('Ada', g1.id);
    await prisma.communityMembership.create({ data: { personId: ada.person.id, communityId: g2.id, status: 'ACTIVE' } });
    const ben = await member('Ben');
    const conv = await privateChat(ada, ben);

    const key = `communities/${g1.id}/attachments/${crypto.randomUUID()}`;
    vi.mocked(storage.headObject).mockResolvedValueOnce({ contentLength: 1000, contentType: 'image/jpeg' } as any);
    const src = await ada.agent
      .post(`${g(g1.id)}/messages`)
      .set('X-CSRF-Token', ada.csrf)
      .send({ body: 'Sunday flyer', attachments: [{ storageKey: key, originalFilename: 'flyer.jpg', mimeType: 'image/jpeg', byteSize: 1000 }] });
    expect(src.status).toBe(201);

    const res = await ada.agent
      .post('/api/chat/forward')
      .set('X-CSRF-Token', ada.csrf)
      .send({
        source: { kind: 'group', chatId: g1.id, messageId: src.body.id },
        targets: [
          { kind: 'group', chatId: g2.id },
          { kind: 'private', chatId: conv },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.sent).toHaveLength(2);
    expect(vi.mocked(storage.copyObject)).toHaveBeenCalledTimes(2);
    const dests = vi.mocked(storage.copyObject).mock.calls.map((c) => c[0].destKey);
    expect(dests[0]).toMatch(new RegExp(`^communities/${g2.id}/attachments/`));
    expect(dests[1]).toMatch(new RegExp(`^private-conversations/${conv}/attachments/`));

    const inG2 = (await listFor(ada, g2.id)).at(-1);
    expect(inG2).toMatchObject({ body: 'Sunday flyer', forwarded: true });
    expect(inG2.attachments).toHaveLength(1);
    const inPrivate = (await ben.agent.get(`${p(conv)}/messages`)).body.items.at(-1);
    expect(inPrivate).toMatchObject({ body: 'Sunday flyer', forwarded: true, isOwn: false });
  });

  it('refuses chats you cannot write in and messages you cannot see', async () => {
    const g1 = await prisma.community.create({ data: { name: 'Mine' } });
    const g2 = await prisma.community.create({ data: { name: 'Not mine' } });
    const ada = await member('Ada', g1.id);
    const id = await say(ada, g1.id, 'Hello');
    const stranger = await member('Stranger', g2.id);

    const notMember = await ada.agent
      .post('/api/chat/forward')
      .set('X-CSRF-Token', ada.csrf)
      .send({ source: { kind: 'group', chatId: g1.id, messageId: id }, targets: [{ kind: 'group', chatId: g2.id }] });
    expect(notMember.status).toBe(403);

    const cantSee = await stranger.agent
      .post('/api/chat/forward')
      .set('X-CSRF-Token', stranger.csrf)
      .send({ source: { kind: 'group', chatId: g1.id, messageId: id }, targets: [{ kind: 'group', chatId: g2.id }] });
    expect(cantSee.status).toBe(404);

    const tooMany = await ada.agent
      .post('/api/chat/forward')
      .set('X-CSRF-Token', ada.csrf)
      .send({ source: { kind: 'group', chatId: g1.id, messageId: id }, targets: Array.from({ length: 6 }, () => ({ kind: 'group', chatId: g1.id })) });
    expect(tooMany.status).toBe(400);
    expect(await prisma.message.count({ where: { forwarded: true, body: 'Hello' } })).toBe(0);
  });
});
