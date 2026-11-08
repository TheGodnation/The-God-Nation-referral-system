import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';

// Storage is mocked (no real R2 in tests): uploads are "verified" by what the test says was uploaded.
vi.mock('../lib/storage', () => ({
  isStorageConfigured: vi.fn(() => true),
  createUploadUrl: vi.fn(async ({ storageKey }: { storageKey: string }) => ({ url: `https://mock-r2.example/upload/${storageKey}`, expiresAt: new Date(Date.now() + 600000) })),
  createDownloadUrl: vi.fn(async ({ storageKey }: { storageKey: string }) => ({ url: `https://mock-r2.example/download/${storageKey}`, expiresAt: new Date(Date.now() + 600000) })),
  headObject: vi.fn(),
  copyObject: vi.fn(async () => undefined),
  deleteObject: vi.fn(async () => undefined),
  getObjectStream: vi.fn(),
  downloadSigningWindowStart: vi.fn(() => new Date()),
  StorageNotConfiguredError: class extends Error {},
}));

import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import * as storage from '../lib/storage';
import { bootstrap } from './testUtils';

// "Message all my people": the people a leader follows each get an ordinary private message with their first name
// in front; nobody can block the people who look after them; the log is readable by the central admin and representatives.
const app = createApp();
const PASSWORD = 'GoodPass123!';
let n = 0;

function agentWithIp() {
  n += 1;
  const raw = request.agent(app);
  const ip = `10.155.${Math.floor(n / 256) % 256}.${n % 256}`;
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const w = {} as Record<(typeof methods)[number], (p: string) => request.Test>;
  for (const m of methods) w[m] = (p: string) => raw[m](p).set('X-Forwarded-For', ip);
  return w;
}
type Who = Awaited<ReturnType<typeof signedIn>>;
async function signedIn(name: string, opts: { admin?: boolean; lang?: 'en' | 'fr' } = {}) {
  n += 1;
  const email = `bc${n}@example.com`;
  const person = await prisma.person.create({ data: { name: `${name} ${n}`, whatsappNumber: `+2377200${String(n).padStart(5, '0')}`, profileCompletedAt: new Date(), preferredLanguage: opts.lang ?? 'en' } });
  await prisma.memberAccount.create({ data: { personId: person.id, email, passwordHash: await bcrypt.hash(PASSWORD, 4) } });
  if (opts.admin) await prisma.user.create({ data: { name: 'Central Admin', email: `bc-admin-${n}@test.local`, passwordHash: 'x', role: 'ADMIN', personId: person.id } });
  const agent = agentWithIp();
  const { csrf } = await bootstrap(agent as any);
  const res = await agent.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email, password: PASSWORD });
  if (res.body.codeRequired) {
    const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
    await agent.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email, password: PASSWORD });
    const code = spy.mock.calls[spy.mock.calls.length - 1][0].code as string;
    await agent.post('/api/member/auth/verify-code').set('X-CSRF-Token', csrf).send({ email, code });
    spy.mockRestore();
  }
  return { person, agent, csrf };
}
const post = (w: Who, path: string, body: unknown) => w.agent.post(path).set('X-CSRF-Token', w.csrf).send(body as object);
const community = (name: string, parentId?: string) => prisma.community.create({ data: { name: `${name} ${++n}`, parentId: parentId ?? null } });
const assignedBy = async () => (await prisma.user.findFirst({ where: { role: 'ADMIN' } })) ?? (await prisma.user.create({ data: { name: 'A', email: `bc-a-${++n}@test.local`, passwordHash: 'x', role: 'ADMIN' } }));
const lead = async (personId: string, communityId: string) => prisma.roleAssignment.create({ data: { personId, roleType: 'SCOPED_LEADER', communityId, assignedByUserId: (await assignedBy()).id } });
const follow = async (followerId: string, followedPersonId: string, communityId: string) =>
  prisma.followUpAssignment.create({ data: { followerId, followedPersonId, contextType: 'COMMUNITY', contextId: communityId, assignedByUserId: (await assignedBy()).id } });
const join = (personId: string, communityId: string) => prisma.communityMembership.create({ data: { personId, communityId } });

afterEach(() => vi.clearAllMocks());

async function world() {
  const hq = await community('BcHQ');
  const A = await community('BcA', hq.id);
  const D = await community('BcD', A.id); // generation 2
  await prisma.settings.upsert({ where: { id: 'singleton' }, update: { headquartersCommunityId: hq.id }, create: { id: 'singleton', headquartersCommunityId: hq.id } as any });
  const leader = await signedIn('Leader');
  await lead(leader.person.id, A.id);
  await join(leader.person.id, A.id);
  const ada = await signedIn('Ada Nkem', { lang: 'en' });
  const marie = await signedIn('Marie Claire', { lang: 'fr' });
  const gone = await prisma.person.create({ data: { name: `Gone ${++n}`, whatsappNumber: `+2377300${String(n).padStart(5, '0')}`, erasedAt: new Date() } });
  const stranger = await signedIn('Stranger');
  for (const p of [ada.person, marie.person, gone]) await follow(leader.person.id, p.id, A.id);
  for (const p of [ada.person, marie.person, stranger.person]) await join(p.id, A.id);
  const admin = await signedIn('Admin', { admin: true });
  return { hq, A, D, leader, ada, marie, gone, stranger, admin };
}
const B = '/api/member/broadcast';

describe('Message all my people', () => {
  it('sends an ordinary private message with the first name in front to each person they follow', async () => {
    const { leader, ada, marie, stranger } = await world();
    const people = await leader.agent.get(`${B}/people`);
    expect(people.body.items.map((p: any) => p.id).sort()).toEqual([ada.person.id, marie.person.id].sort()); // not the erased one, not the stranger

    const res = await post(leader, B, { body: 'God is faithful. See you Sunday.' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ recipients: 2, skipped: 0 });

    for (const [who, greeting] of [[ada, 'Hello Ada,'], [marie, 'Bonjour Marie,']] as const) {
      const convo = await prisma.privateConversation.findUnique({ where: { memberPersonId_initiatorPersonId: { memberPersonId: who.person.id, initiatorPersonId: leader.person.id } } });
      expect(convo).toBeTruthy();
      const messages = await prisma.privateMessage.findMany({ where: { conversationId: convo!.id } });
      expect(messages).toHaveLength(1);
      expect(messages[0].body).toBe(`${greeting}\n\nGod is faithful. See you Sunday.`);
      expect(messages[0].senderPersonId).toBe(leader.person.id);
      expect(await prisma.notification.count({ where: { recipientPersonId: who.person.id, type: 'PRIVATE_MESSAGE_RECEIVED' } })).toBeGreaterThanOrEqual(1);
      // It is a normal conversation: the person sees it in their private chats and can reply.
      const list = await who.agent.get('/api/private-messages/conversations');
      expect(list.body.items.some((c: any) => c.id === convo!.id)).toBe(true);
      const reply = await post(who, `/api/private-messages/conversations/${convo!.id}/messages`, { body: 'Amen, thank you' });
      expect(reply.status).toBe(201);
    }
    expect(await prisma.privateMessage.count({ where: { senderPersonId: leader.person.id, conversation: { memberPersonId: stranger.person.id } } })).toBe(0);
    const mine = await leader.agent.get(`${B}/mine`);
    expect(mine.body.items[0]).toMatchObject({ recipientCount: 2, body: 'God is faithful. See you Sunday.' });
    expect(await prisma.auditLog.findFirst({ where: { action: 'LEADER_BROADCAST_SENT', targetId: res.body.id } })).toBeTruthy();
    // No limit: a second and third go through.
    expect((await post(leader, B, { body: 'Second' })).status).toBe(201);
    expect((await post(leader, B, { body: 'Third' })).status).toBe(201);
  });

  it('can go to chosen people only, needs something to say, and only to people they look after', async () => {
    const { leader, ada, marie, stranger } = await world();
    expect((await post(leader, B, { personIds: [ada.person.id], body: ' ' })).status).toBe(400);
    expect((await post(leader, B, { personIds: [stranger.person.id], body: 'Hi' })).status).toBe(403);
    const ok = await post(leader, B, { personIds: [ada.person.id], body: 'Just you' });
    expect(ok.body.recipients).toBe(1);
    expect(await prisma.privateConversation.count({ where: { memberPersonId: marie.person.id, initiatorPersonId: leader.person.id } })).toBe(0);
    // Only leaders.
    expect((await post(ada, B, { body: 'Hello all' })).status).toBe(403);
    expect((await ada.agent.get(`${B}/people`)).status).toBe(403);
  });

  it('sends photos and voice messages as a copy inside each private chat', async () => {
    const { leader, ada, marie } = await world();
    const photo = { originalFilename: 'flyer.jpg', mimeType: 'image/jpeg', byteSize: 2048 };
    const slot = await post(leader, `${B}/attachments/authorize`, photo);
    expect(slot.status).toBe(200);
    expect(slot.body.storageKey).toMatch(new RegExp(`^private-broadcasts/${leader.person.id}/`));

    vi.mocked(storage.headObject).mockResolvedValue({ contentLength: 2048, contentType: 'image/jpeg' } as any);
    const res = await post(leader, B, { body: 'See the flyer', attachments: [{ storageKey: slot.body.storageKey, ...photo }] });
    expect(res.status).toBe(201);
    expect(storage.copyObject).toHaveBeenCalledTimes(2);
    for (const who of [ada, marie]) {
      const convo = await prisma.privateConversation.findUnique({ where: { memberPersonId_initiatorPersonId: { memberPersonId: who.person.id, initiatorPersonId: leader.person.id } } });
      const msg = await prisma.privateMessage.findFirst({ where: { conversationId: convo!.id }, include: { attachments: true } });
      expect(msg!.attachments).toHaveLength(1);
      expect(msg!.attachments[0].storageKey).toMatch(new RegExp(`^private-conversations/${convo!.id}/attachments/`));
      expect(msg!.attachments[0].mimeType).toBe('image/jpeg');
    }
    expect(storage.deleteObject).toHaveBeenCalledWith({ storageKey: slot.body.storageKey });

    // A voice message alone is enough (the greeting still goes with it).
    const voice = { originalFilename: 'voice.webm', mimeType: 'audio/webm', byteSize: 900 };
    const vslot = await post(leader, `${B}/attachments/authorize`, voice);
    expect(vslot.status).toBe(200);
    vi.mocked(storage.headObject).mockResolvedValue({ contentLength: 900, contentType: 'audio/webm' } as any);
    expect((await post(leader, B, { attachments: [{ storageKey: vslot.body.storageKey, ...voice }] })).status).toBe(201);
  });

  it('refuses other leaders’ staged files, unverified uploads and unsupported types', async () => {
    const { leader, ada } = await world();
    const mime = { originalFilename: 'x.jpg', mimeType: 'image/jpeg', byteSize: 10 };
    expect((await post(leader, B, { attachments: [{ storageKey: `private-broadcasts/${ada.person.id}/${crypto.randomUUID()}`, ...mime }] })).status).toBe(400);
    expect((await post(leader, B, { attachments: [{ storageKey: 'private-conversations/x/attachments/y', ...mime }] })).status).toBe(400);
    vi.mocked(storage.headObject).mockResolvedValue({ contentLength: 999, contentType: 'image/jpeg' } as any);
    expect((await post(leader, B, { attachments: [{ storageKey: `private-broadcasts/${leader.person.id}/${crypto.randomUUID()}`, ...mime }] })).status).toBe(400);
    expect((await post(leader, `${B}/attachments/authorize`, { originalFilename: 'a.exe', mimeType: 'application/x-msdownload', byteSize: 10 })).status).toBe(400);
    expect(storage.copyObject).not.toHaveBeenCalled();
  });
});

describe('The log of group messages', () => {
  it('is readable by the central admin (all) and a representative (only their generation’s leaders), not by others', async () => {
    const { A, D, leader, ada, admin } = await world();
    const deep = await signedIn('DeepLeader');
    await lead(deep.person.id, D.id);
    await follow(deep.person.id, ada.person.id, D.id);
    const rep = await signedIn('Rep');
    await lead(rep.person.id, A.id);
    expect((await post(admin, '/api/member/central-representatives/appoint', { personId: rep.person.id, generation: 1 })).status).toBe(201);
    await post(leader, B, { body: 'From generation one' });
    await post(deep, B, { body: 'From generation two' });

    const all = await admin.agent.get('/api/member/central-broadcast-log');
    const texts = all.body.items.map((i: any) => i.body);
    expect(texts).toEqual(expect.arrayContaining(['From generation one', 'From generation two']));
    const repView = await rep.agent.get('/api/member/rep-broadcast-log');
    expect(repView.status).toBe(200);
    const repTexts = repView.body.items.map((i: any) => i.body);
    expect(repTexts).toContain('From generation one');
    expect(repTexts).not.toContain('From generation two');
    expect((await leader.agent.get('/api/member/central-broadcast-log')).status).toBe(403);
    expect((await leader.agent.get('/api/member/rep-broadcast-log')).status).toBe(403);
    const anon = agentWithIp();
    expect((await anon.get('/api/admin/broadcast-log')).status).toBe(401);
    expect((await anon.get('/api/member/broadcast/people')).status).toBe(401);
  });
});

describe('Who cannot be blocked', () => {
  const block = (who: Who, personId: string) => post(who, '/api/member/blocks', { personId });

  it('leaders of your assembly or generation, your own leader, the representative of your generation and the central admin cannot be blocked', async () => {
    const { hq, A, D, leader, ada, admin } = await world();
    const sibling = await community('BcSibling', hq.id); // another generation-1 assembly
    const sameGen = await signedIn('SameGenLeader');
    await lead(sameGen.person.id, sibling.id);
    const rep = await signedIn('Rep');
    await lead(rep.person.id, D.id); // leads generation 2 but represents generation 1
    expect((await post(admin, '/api/member/central-representatives/appoint', { personId: rep.person.id, generation: 1 })).status).toBe(201);
    const distant = await signedIn('DistantLeader');
    await lead(distant.person.id, D.id); // generation 2: not Ada's assembly or generation

    for (const protectedPerson of [leader, sameGen, admin, rep]) {
      const res = await block(ada, protectedPerson.person.id);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('CANNOT_BLOCK');
    }
    expect(await prisma.personBlock.count({ where: { blockerPersonId: ada.person.id } })).toBe(0);
    // Her own leader (who follows her) cannot be blocked even from another generation.
    await follow(distant.person.id, ada.person.id, D.id);
    expect((await block(ada, distant.person.id)).status).toBe(403);

    // Ordinary members and leaders far from her can be blocked.
    const other = await signedIn('Other');
    expect((await block(ada, other.person.id)).status).toBe(200);
    const faraway = await signedIn('FarAway');
    await lead(faraway.person.id, (await community('BcFar', D.id)).id); // generation 3
    expect((await block(ada, faraway.person.id)).status).toBe(200);
    void A;
  });

  it('ignores an older block of someone who cannot be blocked, so they can still write to each other', async () => {
    const { leader, ada } = await world();
    await prisma.personBlock.create({ data: { blockerPersonId: ada.person.id, blockedPersonId: leader.person.id } });
    const res = await post(leader, B, { body: 'Hello anyway' });
    expect(res.body.recipients).toBe(2);
    const convo = await prisma.privateConversation.findUnique({ where: { memberPersonId_initiatorPersonId: { memberPersonId: ada.person.id, initiatorPersonId: leader.person.id } } });
    expect((await post(ada, `/api/private-messages/conversations/${convo!.id}/messages`, { body: 'I can still answer' })).status).toBe(201);
    expect((await post(leader, `/api/private-messages/conversations/${convo!.id}/messages`, { body: 'And so can I' })).status).toBe(201);
  });
});
