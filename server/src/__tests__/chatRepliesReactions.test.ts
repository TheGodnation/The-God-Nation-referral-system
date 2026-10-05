import crypto from 'crypto';
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { bootstrap } from './testUtils';

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
import * as storage from '../lib/storage';

// WhatsApp-style group chat: replies, reactions, sender photos, and the
// voice-note / iPhone video file types.
const app = createApp();

let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.121.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) {
    wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', ip);
  }
  return wrapped;
}

let n = 0;
async function member(communityId: string, name = 'Chat Person') {
  n += 1;
  const email = `chat${n}@example.com`;
  const person = await prisma.person.create({
    data: { name: `${name} ${n}`, whatsappNumber: `+2376559${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() },
  });
  await prisma.memberAccount.create({ data: { personId: person.id, email } });
  await prisma.communityMembership.create({ data: { personId: person.id, communityId, status: 'ACTIVE' } });

  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/member/auth/request-code').set('X-CSRF-Token', csrf).send({ email });
  const code = spy.mock.calls[0][0].code as string;
  spy.mockRestore();
  await agent.post('/api/member/auth/verify-code').set('X-CSRF-Token', csrf).send({ email, code });
  return { agent, csrf, person };
}

async function group(name: string) {
  return prisma.community.create({ data: { name } });
}

async function post(m: { agent: ReturnType<typeof agentWithUniqueIp>; csrf: string }, communityId: string, body: Record<string, unknown>) {
  return m.agent.post(`/api/communities/${communityId}/conversation/messages`).set('X-CSRF-Token', m.csrf).send(body);
}

async function list(m: { agent: ReturnType<typeof agentWithUniqueIp> }, communityId: string) {
  return m.agent.get(`/api/communities/${communityId}/conversation/messages`);
}

describe('Group chat replies', () => {
  it('a reply shows a short preview of the message it answers', async () => {
    const g = await group('Reply Group 1');
    const ada = await member(g.id, 'Ada');
    const ben = await member(g.id, 'Ben');

    const first = await post(ada, g.id, { body: 'Who is coming on Sunday?' });
    expect(first.status).toBe(201);
    const reply = await post(ben, g.id, { body: 'I am coming', replyToMessageId: first.body.id });
    expect(reply.status).toBe(201);
    expect(reply.body.replyTo).toMatchObject({ id: first.body.id, body: 'Who is coming on Sunday?' });

    const res = await list(ada, g.id);
    const item = res.body.items.find((m: any) => m.id === reply.body.id);
    expect(item.replyTo).toMatchObject({ id: first.body.id, body: 'Who is coming on Sunday?', deleted: false });
    expect(item.replyTo.senderName).toContain('Ada');
  });

  it('cannot reply to a message from another group', async () => {
    const g1 = await group('Reply Group 2a');
    const g2 = await group('Reply Group 2b');
    const ada = await member(g1.id);
    const ben = await member(g2.id);
    const other = await post(ada, g1.id, { body: 'Group one only' });
    const res = await post(ben, g2.id, { body: 'Sneaky', replyToMessageId: other.body.id });
    expect(res.status).toBe(400);
  });

  it('a removed message is never shown inside a reply preview', async () => {
    const g = await group('Reply Group 3');
    const ada = await member(g.id);
    const ben = await member(g.id);
    const first = await post(ada, g.id, { body: 'Secret words' });
    const reply = await post(ben, g.id, { body: 'Answer', replyToMessageId: first.body.id });
    await prisma.message.update({ where: { id: first.body.id }, data: { deletedAt: new Date(), deletedByPersonId: ada.person.id } });

    const res = await list(ben, g.id);
    const item = res.body.items.find((m: any) => m.id === reply.body.id);
    expect(item.replyTo.deleted).toBe(true);
    expect(item.replyTo.body).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain('Secret words');
  });
});

describe('Group chat reactions', () => {
  it('react, change the emoji, and remove it', async () => {
    const g = await group('React Group 1');
    const ada = await member(g.id);
    const ben = await member(g.id);
    const msg = await post(ada, g.id, { body: 'Praise God!' });
    const url = `/api/communities/${g.id}/conversation/messages/${msg.body.id}/reaction`;

    const r1 = await ben.agent.put(url).set('X-CSRF-Token', ben.csrf).send({ emoji: '🙏' });
    expect(r1.status).toBe(200);
    expect(r1.body.reactions).toEqual([{ emoji: '🙏', count: 1, mine: true }]);

    await ada.agent.put(url).set('X-CSRF-Token', ada.csrf).send({ emoji: '🙏' });
    const r2 = await ben.agent.put(url).set('X-CSRF-Token', ben.csrf).send({ emoji: '❤️' });
    expect(r2.body.reactions).toEqual([
      { emoji: '❤️', count: 1, mine: true },
      { emoji: '🙏', count: 1, mine: false },
    ]);

    const listed = await list(ada, g.id);
    expect(listed.body.items.find((m: any) => m.id === msg.body.id).reactions).toEqual([
      { emoji: '❤️', count: 1, mine: false },
      { emoji: '🙏', count: 1, mine: true },
    ]);

    const r3 = await ben.agent.delete(url).set('X-CSRF-Token', ben.csrf);
    expect(r3.body.reactions).toEqual([{ emoji: '🙏', count: 1, mine: false }]);
    expect(await prisma.messageReaction.count({ where: { messageId: msg.body.id } })).toBe(1);
  });

  it('only the six WhatsApp-style emojis are accepted', async () => {
    const g = await group('React Group 2');
    const ada = await member(g.id);
    const msg = await post(ada, g.id, { body: 'Hello' });
    const res = await ada.agent
      .put(`/api/communities/${g.id}/conversation/messages/${msg.body.id}/reaction`)
      .set('X-CSRF-Token', ada.csrf)
      .send({ emoji: 'hello there' });
    expect(res.status).toBe(400);
  });

  it('people outside the group cannot react, and removed messages cannot be reacted to', async () => {
    const g = await group('React Group 3');
    const other = await group('React Group 3 other');
    const ada = await member(g.id);
    const stranger = await member(other.id);
    const msg = await post(ada, g.id, { body: 'Inside only' });
    const url = `/api/communities/${g.id}/conversation/messages/${msg.body.id}/reaction`;

    const outside = await stranger.agent.put(url).set('X-CSRF-Token', stranger.csrf).send({ emoji: '👍' });
    expect(outside.status).toBe(403);

    await prisma.message.update({ where: { id: msg.body.id }, data: { deletedAt: new Date() } });
    const removed = await ada.agent.put(url).set('X-CSRF-Token', ada.csrf).send({ emoji: '👍' });
    expect(removed.status).toBe(404);
  });
});

describe('Group chat media', () => {
  it('lists the sender photo link for each message', async () => {
    const g = await group('Photo Group 1');
    const ada = await member(g.id);
    await prisma.person.update({
      where: { id: ada.person.id },
      data: { photoStorageKey: `people/${ada.person.id}/photo/${crypto.randomUUID()}`, photoUpdatedAt: new Date() },
    });
    await post(ada, g.id, { body: 'With my photo' });
    const res = await list(ada, g.id);
    expect(res.body.items[0].senderPhotoUrl).toContain(`/api/people/${ada.person.id}/photo`);
  });

  it('accepts browser voice notes (audio/webm) and iPhone videos (video/quicktime)', async () => {
    const g = await group('Media Group 1');
    const ada = await member(g.id);
    for (const mimeType of ['audio/webm', 'video/quicktime']) {
      const auth = await ada.agent
        .post(`/api/communities/${g.id}/attachments/authorize`)
        .set('X-CSRF-Token', ada.csrf)
        .send({ originalFilename: `clip.${mimeType.split('/')[1]}`, mimeType, byteSize: 1000 });
      expect(auth.status).toBe(200);
      vi.mocked(storage.headObject).mockResolvedValueOnce({ contentLength: 1000, contentType: mimeType } as any);
      const sent = await post(ada, g.id, {
        attachments: [{ storageKey: auth.body.storageKey, originalFilename: `clip.${mimeType.split('/')[1]}`, mimeType, byteSize: 1000 }],
      });
      expect(sent.status).toBe(201);
    }
  });
});
