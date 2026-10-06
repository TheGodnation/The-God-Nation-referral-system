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
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  })),
  headObject: vi.fn(async () => null),
}));

import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import * as storage from '../lib/storage';
import { bootstrap } from './testUtils';

// Private messages as a WhatsApp screen: open a chat, photos/voice notes,
// replies, reactions, sender photo and last-message preview.
const app = createApp();

let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.128.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) {
    wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', ip);
  }
  return wrapped;
}

let n = 0;
async function member(name = 'Chatter') {
  n += 1;
  const email = `pc${n}@example.com`;
  const person = await prisma.person.create({
    data: { name: `${name} ${n}`, whatsappNumber: `+2376556${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() },
  });
  await prisma.memberAccount.create({ data: { personId: person.id, email } });
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

async function friends(a: M, b: M) {
  await prisma.friendship.create({ data: { requesterPersonId: a.person.id, addresseePersonId: b.person.id, status: 'ACCEPTED', respondedAt: new Date() } });
}

async function open(a: M, b: M) {
  const res = await a.agent.post('/api/member/messages/open').set('X-CSRF-Token', a.csrf).send({ personId: b.person.id });
  return res;
}

function base(id: string) {
  return `/api/private-messages/conversations/${id}`;
}

async function send(m: M, conversationId: string, body: Record<string, unknown>) {
  return m.agent.post(`${base(conversationId)}/messages`).set('X-CSRF-Token', m.csrf).send(body);
}

describe('Opening a private chat', () => {
  it('friends can open a chat without writing first, and get the same chat each time', async () => {
    const ada = await member('Ada');
    const ben = await member('Ben');
    await friends(ada, ben);
    const first = await open(ada, ben);
    expect(first.status).toBe(200);
    expect((await open(ada, ben)).body.conversationId).toBe(first.body.conversationId);
    expect((await open(ben, ada)).body.conversationId).toBe(first.body.conversationId);
  });

  it('strangers cannot open a chat', async () => {
    const ada = await member();
    const stranger = await member();
    const res = await open(ada, stranger);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('NOT_ALLOWED');
  });
});

describe('Private chat messages', () => {
  it('shows the other person photo and the last message in the chat list', async () => {
    const ada = await member('Ada');
    const ben = await member('Ben');
    await friends(ada, ben);
    await prisma.person.update({
      where: { id: ben.person.id },
      data: { photoStorageKey: `people/${ben.person.id}/photo/${crypto.randomUUID()}`, photoUpdatedAt: new Date() },
    });
    const { conversationId } = (await open(ada, ben)).body;
    await send(ada, conversationId, { body: 'Good morning' });

    const list = await ada.agent.get('/api/private-messages/conversations');
    const row = list.body.items.find((c: any) => c.id === conversationId);
    expect(row.otherPartyPhotoUrl).toContain(`/api/people/${ben.person.id}/photo`);
    expect(row.lastMessage).toMatchObject({ body: 'Good morning', isOwn: true, attachmentMimeType: null });

    const benList = await ben.agent.get('/api/private-messages/conversations');
    expect(benList.body.items.find((c: any) => c.id === conversationId).lastMessage.isOwn).toBe(false);
  });

  it('sends a voice note (attachment only) and a reply', async () => {
    const ada = await member();
    const ben = await member();
    await friends(ada, ben);
    const { conversationId } = (await open(ada, ben)).body;

    const auth = await ada.agent
      .post(`${base(conversationId)}/attachments/authorize`)
      .set('X-CSRF-Token', ada.csrf)
      .send({ originalFilename: 'voice-note.webm', mimeType: 'audio/webm', byteSize: 5000 });
    expect(auth.status).toBe(200);
    expect(auth.body.storageKey).toMatch(new RegExp(`^private-conversations/${conversationId}/attachments/`));

    vi.mocked(storage.headObject).mockResolvedValueOnce({ contentLength: 5000, contentType: 'audio/webm' } as any);
    const voice = await send(ada, conversationId, {
      attachments: [{ storageKey: auth.body.storageKey, originalFilename: 'voice-note.webm', mimeType: 'audio/webm', byteSize: 5000 }],
    });
    expect(voice.status).toBe(201);
    expect(voice.body.body).toBe('');

    const reply = await send(ben, conversationId, { body: 'Amen!', replyToMessageId: voice.body.id });
    expect(reply.status).toBe(201);

    const msgs = await ben.agent.get(`${base(conversationId)}/messages`);
    const [v, r] = msgs.body.items;
    expect(v.attachments[0]).toMatchObject({ mimeType: 'audio/webm', originalFilename: 'voice-note.webm' });
    expect(r.replyTo).toMatchObject({ id: voice.body.id, isOwn: false, attachmentMimeType: 'audio/webm' });

    const dl = await ben.agent.get(`${base(conversationId)}/messages/${v.id}/attachments/${v.attachments[0].id}/download-url`);
    expect(dl.status).toBe(200);
    expect(dl.body.url).toContain(auth.body.storageKey);
  });

  it('refuses an empty message, a file key from another chat, and a reply to another chat', async () => {
    const ada = await member();
    const ben = await member();
    const cy = await member();
    await friends(ada, ben);
    await friends(ada, cy);
    const c1 = (await open(ada, ben)).body.conversationId;
    const c2 = (await open(ada, cy)).body.conversationId;

    expect((await send(ada, c1, { body: '   ' })).status).toBe(400);

    vi.mocked(storage.headObject).mockResolvedValue({ contentLength: 10, contentType: 'image/jpeg' } as any);
    const otherKey = `private-conversations/${c2}/attachments/${crypto.randomUUID()}`;
    const bad = await send(ada, c1, { attachments: [{ storageKey: otherKey, originalFilename: 'a.jpg', mimeType: 'image/jpeg', byteSize: 10 }] });
    expect(bad.status).toBe(400);
    vi.mocked(storage.headObject).mockResolvedValue(null);

    const inC2 = await send(ada, c2, { body: 'hello cy' });
    expect((await send(ada, c1, { body: 'sneaky', replyToMessageId: inC2.body.id })).status).toBe(400);
  });

  it('react, change and remove a reaction; outsiders cannot react', async () => {
    const ada = await member();
    const ben = await member();
    const outsider = await member();
    await friends(ada, ben);
    const { conversationId } = (await open(ada, ben)).body;
    const msg = await send(ada, conversationId, { body: 'Thank you' });
    const url = `${base(conversationId)}/messages/${msg.body.id}/reaction`;

    const r1 = await ben.agent.put(url).set('X-CSRF-Token', ben.csrf).send({ emoji: '🙏' });
    expect(r1.body.reactions).toEqual([{ emoji: '🙏', count: 1, mine: true }]);
    const r2 = await ben.agent.put(url).set('X-CSRF-Token', ben.csrf).send({ emoji: '❤️' });
    expect(r2.body.reactions).toEqual([{ emoji: '❤️', count: 1, mine: true }]);

    const seen = await ada.agent.get(`${base(conversationId)}/messages`);
    expect(seen.body.items[0].reactions).toEqual([{ emoji: '❤️', count: 1, mine: false }]);

    const r3 = await ben.agent.delete(url).set('X-CSRF-Token', ben.csrf);
    expect(r3.body.reactions).toEqual([]);

    expect((await outsider.agent.put(url).set('X-CSRF-Token', outsider.csrf).send({ emoji: '👍' })).status).toBe(404);
    expect((await ben.agent.put(url).set('X-CSRF-Token', ben.csrf).send({ emoji: 'nope' })).status).toBe(400);
  });
});
