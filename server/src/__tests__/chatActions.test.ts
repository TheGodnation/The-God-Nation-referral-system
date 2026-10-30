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

// WhatsApp actions: delete for everyone, edit, search, forward. (No mute —
// members always receive notifications; see "No longer exposes a mute
// endpoint" below.)
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

    // An edit can be as long as the message was allowed to be when first
    // sent (WhatsApp's own 65,536-char limit), not capped back down to an
    // old, smaller bound.
    const longEdit = await ada.agent.patch(`${g(c.id)}/messages/${id}`).set('X-CSRF-Token', ada.csrf).send({ body: 'x'.repeat(5000) });
    expect(longEdit.status).toBe(200);
    expect(longEdit.body.body).toHaveLength(5000);
    expect((await ada.agent.patch(`${g(c.id)}/messages/${id}`).set('X-CSRF-Token', ada.csrf).send({ body: 'x'.repeat(65537) })).status).toBe(400);

    await prisma.message.update({ where: { id }, data: { createdAt: new Date(Date.now() - 20 * 60 * 1000) } });
    expect((await ada.agent.patch(`${g(c.id)}/messages/${id}`).set('X-CSRF-Token', ada.csrf).send({ body: 'Too late' })).status).toBe(400);
  });
});

describe('Group: search', () => {
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

  it('no longer exposes a mute endpoint — members always receive notifications', async () => {
    const c = await prisma.community.create({ data: { name: 'No Mute Group' } });
    const ada = await member('Ada', c.id);
    expect((await ada.agent.put(`${g(c.id)}/mute`).set('X-CSRF-Token', ada.csrf).send({ for: '8h' })).status).toBe(404);
    expect((await ada.agent.get(g(c.id))).body.muted).toBeUndefined();
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

  it('a forwarded voice note or text keeps its transcript and translation in the other group, and a private chat gets none', async () => {
    const g1 = await prisma.community.create({ data: { name: 'Voice From' } });
    const g2 = await prisma.community.create({ data: { name: 'Voice To' } });
    const ada = await member('Ada Voice', g1.id);
    await prisma.communityMembership.create({ data: { personId: ada.person.id, communityId: g2.id, status: 'ACTIVE' } });
    const ben = await member('Ben Voice');
    const conv = await privateChat(ada, ben);
    const conversation = await prisma.conversation.create({ data: { communityId: g1.id } });
    const voice = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderPersonId: ada.person.id,
        body: null,
        transcribedLanguage: 'en',
        transcribedBody: 'God is good.',
        translatedTranscript: 'Dieu est bon.',
        transcribedAt: new Date(),
        attachments: { create: [{ storageKey: `communities/${g1.id}/attachments/${crypto.randomUUID()}`, originalFilename: 'v.webm', mimeType: 'audio/webm', byteSize: 10, uploadedByPersonId: ada.person.id }] },
      },
    });
    const text = await prisma.message.create({
      data: { conversationId: conversation.id, senderPersonId: ada.person.id, body: 'Praise the Lord', detectedLanguage: 'en', translatedBody: 'Louez le Seigneur', translatedAt: new Date() },
    });

    const res = await ada.agent
      .post('/api/chat/forward')
      .set('X-CSRF-Token', ada.csrf)
      .send({ source: { kind: 'group', chatId: g1.id, messageIds: [voice.id, text.id] }, targets: [{ kind: 'group', chatId: g2.id }, { kind: 'private', chatId: conv }] });
    expect(res.status).toBe(201);

    const copies = await prisma.message.findMany({ where: { conversation: { communityId: g2.id }, forwarded: true }, orderBy: { createdAt: 'asc' } });
    expect(copies).toHaveLength(2);
    expect(copies[0]).toMatchObject({ transcribedLanguage: 'en', transcribedBody: 'God is good.', translatedTranscript: 'Dieu est bon.' });
    expect(copies[0].transcribedAt).not.toBeNull();
    expect(copies[1]).toMatchObject({ detectedLanguage: 'en', translatedBody: 'Louez le Seigneur' });
    // A private chat is never translated: its copy carries nothing.
    const inPrivate = await prisma.privateMessage.findMany({ where: { conversationId: conv } });
    expect(inPrivate).toHaveLength(2);
  });

  describe('the "Forwarded" label', () => {
    async function setup() {
      const g1 = await prisma.community.create({ data: { name: 'Sub assembly' } });
      const g2 = await prisma.community.create({ data: { name: 'Headquarters' } });
      const boss = await member('Boss', g1.id);
      await prisma.communityMembership.create({ data: { personId: boss.person.id, communityId: g2.id, status: 'ACTIVE' } });
      await prisma.user.create({
        data: { name: 'Central Admin', email: `fwd-admin-${n}@test.local`, passwordHash: 'x', role: 'ADMIN', personId: boss.person.id },
      });
      const ada = await member('Ada', g1.id);
      await prisma.communityMembership.create({ data: { personId: ada.person.id, communityId: g2.id, status: 'ACTIVE' } });
      const send = async (who: typeof boss, body: string) =>
        (await who.agent.post(`${g(g1.id)}/messages`).set('X-CSRF-Token', who.csrf).send({ body })).body.id as string;
      const forward = (who: typeof boss, messageId: string, extra: object = {}) =>
        who.agent
          .post('/api/chat/forward')
          .set('X-CSRF-Token', who.csrf)
          .send({ source: { kind: 'group', chatId: g1.id, messageId }, targets: [{ kind: 'group', chatId: g2.id }], ...extra });
      return { g2, boss, ada, send, forward };
    }

    it('sends the central admin\'s own message without the label', async () => {
      const { g2, boss, send, forward } = await setup();
      const res = await forward(boss, await send(boss, 'My own words'));
      expect(res.status).toBe(201);
      expect((await listFor(boss, g2.id)).at(-1)).toMatchObject({ body: 'My own words', forwarded: false });
    });

    it('keeps the label on someone else\'s message unless the central admin switches it off', async () => {
      const { g2, boss, ada, send, forward } = await setup();
      const hers = await send(ada, 'Ada wrote this');
      await forward(boss, hers);
      expect((await listFor(boss, g2.id)).at(-1)).toMatchObject({ body: 'Ada wrote this', forwarded: true });
      await forward(boss, hers, { markForwarded: false });
      expect((await listFor(boss, g2.id)).at(-1)).toMatchObject({ body: 'Ada wrote this', forwarded: false });
    });

    it('always keeps the label for everyone else, even if they ask to hide it', async () => {
      const { g2, boss, ada, send, forward } = await setup();
      await forward(ada, await send(ada, 'Ada again'), { markForwarded: false });
      expect((await listFor(boss, g2.id)).at(-1)).toMatchObject({ body: 'Ada again', forwarded: true });
    });

    it('tells the forward screen who may hide the label', async () => {
      const { boss, ada } = await setup();
      expect((await boss.agent.get('/api/chat/forward/options')).body).toEqual({ canHideLabel: true });
      expect((await ada.agent.get('/api/chat/forward/options')).body).toEqual({ canHideLabel: false });
    });
  });

  it('forwards several selected messages together, in order, each marked forwarded', async () => {
    const g1 = await prisma.community.create({ data: { name: 'Multi From' } });
    const g2 = await prisma.community.create({ data: { name: 'Multi To' } });
    const ada = await member('Ada', g1.id);
    await prisma.communityMembership.create({ data: { personId: ada.person.id, communityId: g2.id, status: 'ACTIVE' } });
    const ben = await member('Ben', g1.id);
    const one = await say(ben, g1.id, 'First thing');
    const two = await say(ada, g1.id, 'Second thing');
    const three = await say(ben, g1.id, 'Third thing');

    const res = await ada.agent
      .post('/api/chat/forward')
      .set('X-CSRF-Token', ada.csrf)
      .send({ source: { kind: 'group', chatId: g1.id, messageId: one, messageIds: [one, two, three] }, targets: [{ kind: 'group', chatId: g2.id }] });
    expect(res.status).toBe(201);
    expect(res.body.sent).toHaveLength(3);
    const copies = (await listFor(ada, g2.id)).slice(-3);
    expect(copies.map((m: any) => m.body)).toEqual(['First thing', 'Second thing', 'Third thing']);
    expect(copies.every((m: any) => m.forwarded === true)).toBe(true);

    // The same message ticked twice counts once; and one message you cannot read stops the whole forward.
    const dup = await ada.agent
      .post('/api/chat/forward')
      .set('X-CSRF-Token', ada.csrf)
      .send({ source: { kind: 'group', chatId: g1.id, messageIds: [one, one] }, targets: [{ kind: 'group', chatId: g2.id }] });
    expect(dup.body.sent).toHaveLength(1);
    const before = await prisma.message.count({ where: { forwarded: true } });
    const bad = await ada.agent
      .post('/api/chat/forward')
      .set('X-CSRF-Token', ada.csrf)
      .send({ source: { kind: 'group', chatId: g1.id, messageIds: [one, '00000000-0000-0000-0000-000000000000'] }, targets: [{ kind: 'group', chatId: g2.id }] });
    expect(bad.status).toBe(404);
    expect(await prisma.message.count({ where: { forwarded: true } })).toBe(before);

    // No more than 20 at once, and something must be chosen.
    const tooMany = await ada.agent
      .post('/api/chat/forward')
      .set('X-CSRF-Token', ada.csrf)
      .send({ source: { kind: 'group', chatId: g1.id, messageIds: Array.from({ length: 21 }, () => one) }, targets: [{ kind: 'group', chatId: g2.id }] });
    expect(tooMany.status).toBe(400);
    const none = await ada.agent.post('/api/chat/forward').set('X-CSRF-Token', ada.csrf).send({ source: { kind: 'group', chatId: g1.id }, targets: [{ kind: 'group', chatId: g2.id }] });
    expect(none.status).toBe(400);
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

describe('Two-language voice message, live teaching and "recording…"', () => {
  async function setup() {
    const g1 = await prisma.community.create({ data: { name: 'Bilingual Assembly' } });
    const boss = await member('Evangelist', g1.id);
    await prisma.user.create({
      data: { name: 'Central Admin', email: `bi-admin-${n}@test.local`, passwordHash: 'x', role: 'ADMIN', personId: boss.person.id },
    });
    const ada = await member('Ada', g1.id);
    const clip = (language: string | undefined, mime = 'audio/webm') => ({
      storageKey: `communities/${g1.id}/attachments/${crypto.randomUUID()}`,
      originalFilename: `voice-${language ?? 'x'}.webm`,
      mimeType: mime,
      byteSize: 1000,
      language,
    });
    const sendClips = async (who: M, clips: ReturnType<typeof clip>[], extra: object = {}) => {
      for (const c of clips) vi.mocked(storage.headObject).mockResolvedValueOnce({ contentLength: c.byteSize, contentType: c.mimeType } as any);
      return who.agent.post(`${g(g1.id)}/messages`).set('X-CSRF-Token', who.csrf).send({ attachments: clips, ...extra });
    };
    return { g1, boss, ada, clip, sendClips };
  }

  it('the central admin sends an English and a French clip as one message, marked live; readers see both labelled', async () => {
    const { g1, boss, ada, clip, sendClips } = await setup();
    const res = await sendClips(boss, [clip('en'), clip('fr')], { liveTeaching: true });
    expect(res.status).toBe(201);
    const seen = (await listFor(ada, g1.id)).at(-1);
    expect(seen.liveTeaching).toBe(true);
    expect(seen.attachments.map((a: any) => a.language)).toEqual(['en', 'fr']);
    // Nothing to transcribe or translate: the message carries no transcript.
    expect(seen.transcript ?? null).toBeNull();
  });

  it('a single recording is an ordinary voice note (no label), still markable as live', async () => {
    const { g1, boss, ada, clip, sendClips } = await setup();
    await sendClips(boss, [clip(undefined)], { liveTeaching: true });
    const seen = (await listFor(ada, g1.id)).at(-1);
    expect(seen.liveTeaching).toBe(true);
    expect(seen.attachments.map((a: any) => a.language)).toEqual([undefined]);
  });

  it('anyone else\'s labels and live mark are ignored', async () => {
    const { g1, boss, ada, clip, sendClips } = await setup();
    const res = await sendClips(ada, [clip('en'), clip('fr')], { liveTeaching: true });
    expect(res.status).toBe(201);
    const seen = (await listFor(boss, g1.id)).at(-1);
    expect(seen.liveTeaching).toBeUndefined();
    expect(seen.attachments.every((a: any) => a.language === undefined)).toBe(true);
  });

  it('two clips in the same language, or a clip with a photo, are not a pair', async () => {
    const { g1, boss, ada, clip, sendClips } = await setup();
    await sendClips(boss, [clip('en'), clip('en')]);
    await sendClips(boss, [clip('en'), clip('fr', 'image/jpeg')]);
    const items = await listFor(ada, g1.id);
    for (const m of items.slice(-2)) expect(m.attachments.every((a: any) => a.language === undefined)).toBe(true);
  });

  it('a forwarded pair keeps both labels', async () => {
    const { g1, boss, clip, sendClips } = await setup();
    const g2 = await prisma.community.create({ data: { name: 'Second Assembly' } });
    await prisma.communityMembership.create({ data: { personId: boss.person.id, communityId: g2.id, status: 'ACTIVE' } });
    const sent = await sendClips(boss, [clip('fr'), clip('en')], { liveTeaching: true });
    const res = await boss.agent
      .post('/api/chat/forward')
      .set('X-CSRF-Token', boss.csrf)
      .send({ source: { kind: 'group', chatId: g1.id, messageId: sent.body.id }, targets: [{ kind: 'group', chatId: g2.id }] });
    expect(res.status).toBe(201);
    const copy = (await listFor(boss, g2.id)).at(-1);
    expect(copy.attachments.map((a: any) => a.language)).toEqual(['fr', 'en']);
    // The live mark belongs to the original only.
    expect(copy.liveTeaching).toBeUndefined();
  });

  it('shows others "is recording" (live only for the central admin) until it stops', async () => {
    const { g1, boss, ada } = await setup();
    const ping = (who: M, body: object) => who.agent.post(`${g(g1.id)}/typing`).set('X-CSRF-Token', who.csrf).send(body);
    const recordingFor = async (who: M) => (await who.agent.get(`${g(g1.id)}/messages`)).body.recording;

    await ping(boss, { recording: true, live: true });
    expect(await recordingFor(ada)).toEqual([{ name: boss.person.name, live: true }]);
    // Never shown to the person recording.
    expect(await recordingFor(boss)).toEqual([]);
    // Recording is not "typing".
    expect((await ada.agent.get(`${g(g1.id)}/messages`)).body.typing).toEqual([]);

    await ping(boss, { typing: false });
    expect(await recordingFor(ada)).toEqual([]);

    // Only the central admin's recording is announced: anyone else's is not shown, live or not.
    await ping(ada, { recording: true, live: true });
    expect(await recordingFor(boss)).toEqual([]);
    expect((await ping(ada, { recording: true })).status).toBe(200);
    expect(await recordingFor(boss)).toEqual([]);
  });

  it('in a private chat "recording" is shown for the central admin only', async () => {
    const a = await member('Rec A');
    const b = await member('Rec B');
    const conv = await privateChat(a, b);
    // An ordinary member recording: nothing shown.
    await a.agent.post(`${p(conv)}/typing`).set('X-CSRF-Token', a.csrf).send({ recording: true });
    expect((await b.agent.get(`${p(conv)}/messages`)).body.recording).toBe(false);
    // The central admin's member profile: shown, and it is not "typing".
    await prisma.user.create({ data: { name: 'Central Admin', email: `rec-admin-${n}@test.local`, passwordHash: 'x', role: 'ADMIN', personId: a.person.id } });
    await a.agent.post(`${p(conv)}/typing`).set('X-CSRF-Token', a.csrf).send({ recording: true });
    const seen = (await b.agent.get(`${p(conv)}/messages`)).body;
    expect(seen.recording).toBe(true);
    expect(seen.typing).toBe(false);
  });
});

describe('Notifications for posts, likes and replies', () => {
  const bell = async (m: M) => (await m.agent.get('/api/notifications?page=1&pageSize=50')).body.items as any[];
  const ofType = async (m: M, type: string) => (await bell(m)).filter((x) => x.type === type);

  async function world() {
    const mine = await prisma.community.create({ data: { name: 'Mine' } });
    const other = await prisma.community.create({ data: { name: 'Other' } });
    const boss = await member('Boss', mine.id);
    await prisma.user.create({ data: { name: 'Central Admin', email: `pn-admin-${n}@test.local`, passwordHash: 'x', role: 'ADMIN', personId: boss.person.id } });
    const ada = await member('Ada', mine.id);
    const ben = await member('Ben', mine.id);
    const zed = await member('Zed', other.id);
    return { mine, other, boss, ada, ben, zed };
  }
  const post = (m: M, body: string) => m.agent.post('/api/updates').set('X-CSRF-Token', m.csrf).send({ body });
  const settle = () => new Promise((r) => setTimeout(r, 400));

  it('a member\'s new post tells only their own assembly; the central admin\'s tells everyone', async () => {
    const { mine, boss, ada, ben, zed } = await world();
    // The central admin's posts reach everyone under Headquarters: set the tree up.
    const hq = await prisma.community.create({ data: { name: 'HQ' } });
    await prisma.settings.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', headquartersCommunityId: hq.id }, update: { headquartersCommunityId: hq.id } });
    await prisma.community.updateMany({ where: { id: { in: [mine.id] } }, data: { parentId: hq.id } });
    const zedHome = (await prisma.communityMembership.findFirst({ where: { personId: zed.person.id } }))!.communityId;
    await prisma.community.update({ where: { id: zedHome }, data: { parentId: hq.id } });

    expect((await post(ada, 'Hello from Ada')).status).toBe(201);
    await settle();
    expect(await ofType(ben, 'POST_PUBLISHED')).toHaveLength(1);
    expect((await ofType(ben, 'POST_PUBLISHED'))[0].metadata).toMatchObject({ authorName: ada.person.name, audience: 'COMMUNITY' });
    expect(await ofType(zed, 'POST_PUBLISHED')).toHaveLength(0);
    expect(await ofType(ada, 'POST_PUBLISHED')).toHaveLength(0);

    expect((await post(boss, 'A word for everyone')).status).toBe(201);
    await settle();
    expect(await ofType(zed, 'POST_PUBLISHED')).toHaveLength(1);
    expect((await ofType(zed, 'POST_PUBLISHED'))[0].metadata).toMatchObject({ audience: 'ALL' });
    // The central admin is in Ada's assembly, so was told about Ada's post, but never about his own.
    expect((await ofType(boss, 'POST_PUBLISHED')).map((x) => x.metadata.authorName)).toEqual([ada.person.name]);
  });

  it('a like and a comment on your post tell you; a reply tells whoever was replied to; never yourself', async () => {
    const { ada, ben, zed } = await world();
    const created = await post(ada, 'My post');
    const id = created.body.id as string;
    await settle();

    // Ben likes it: Ada is told once, even if he changes or repeats it.
    await ben.agent.put(`/api/updates/${id}/reaction`).set('X-CSRF-Token', ben.csrf).send({ type: 'LIKE' });
    await ben.agent.put(`/api/updates/${id}/reaction`).set('X-CSRF-Token', ben.csrf).send({ type: 'LOVE' });
    await settle();
    expect(await ofType(ada, 'POST_LIKED')).toHaveLength(1);
    expect((await ofType(ada, 'POST_LIKED'))[0].metadata).toMatchObject({ actorName: ben.person.name, kind: 'POST' });
    // Liking your own post tells nobody.
    await ada.agent.put(`/api/updates/${id}/reaction`).set('X-CSRF-Token', ada.csrf).send({ type: 'LIKE' });
    await settle();
    expect(await ofType(ada, 'POST_LIKED')).toHaveLength(1);

    // Ben comments: Ada is told. Zed replies to Ben's comment: Ben is told "replied to your comment", Ada "commented".
    const comment = await ben.agent.post(`/api/updates/${id}/comments`).set('X-CSRF-Token', ben.csrf).send({ body: 'Amen!' });
    await settle();
    expect((await ofType(ada, 'POST_REPLIED')).map((x) => x.metadata.kind)).toEqual(['POST_COMMENT']);
    await zed.agent.post(`/api/updates/${id}/comments`).set('X-CSRF-Token', zed.csrf).send({ body: 'Thank you Ben', parentCommentId: comment.body.id });
    await settle();
    expect((await ofType(ben, 'POST_REPLIED')).map((x) => x.metadata.kind)).toEqual(['COMMENT_REPLY']);
    expect((await ofType(ada, 'POST_REPLIED')).map((x) => x.metadata.kind).sort()).toEqual(['POST_COMMENT', 'POST_COMMENT']);

    // A like on Ben's comment tells Ben; commenting on your own post tells nobody.
    await zed.agent.put(`/api/updates/comments/${comment.body.id}/reaction`).set('X-CSRF-Token', zed.csrf).send({ type: 'LIKE' });
    await settle();
    expect((await ofType(ben, 'POST_LIKED'))[0].metadata).toMatchObject({ kind: 'COMMENT', actorName: zed.person.name });
    await ada.agent.post(`/api/updates/${id}/comments`).set('X-CSRF-Token', ada.csrf).send({ body: 'Thanks all' });
    await settle();
    expect(await ofType(ada, 'POST_REPLIED')).toHaveLength(2);
  });

  it('a reaction or a quoted reply in a group chat tells the person whose message it was', async () => {
    const { mine, ada, ben, zed } = await world();
    const id = await say(ada, mine.id, 'Good morning family');
    await ben.agent.put(`${g(mine.id)}/messages/${id}/reaction`).set('X-CSRF-Token', ben.csrf).send({ emoji: '🙏' });
    await settle();
    expect((await ofType(ada, 'POST_LIKED'))[0].metadata).toMatchObject({ kind: 'MESSAGE', emoji: '🙏', actorName: ben.person.name });

    await ben.agent.post(`${g(mine.id)}/messages`).set('X-CSRF-Token', ben.csrf).send({ body: 'Good morning!', replyToMessageId: id });
    await settle();
    expect((await ofType(ada, 'POST_REPLIED')).map((x) => x.metadata.kind)).toEqual(['MESSAGE_REPLY']);
    // Replying to yourself tells nobody.
    await ada.agent.post(`${g(mine.id)}/messages`).set('X-CSRF-Token', ada.csrf).send({ body: 'Me again', replyToMessageId: id });
    await settle();
    expect(await ofType(ada, 'POST_REPLIED')).toHaveLength(1);
    expect(await ofType(zed, 'POST_REPLIED')).toHaveLength(0);
  });
});
