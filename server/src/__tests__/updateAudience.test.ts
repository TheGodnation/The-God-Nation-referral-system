import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

vi.mock('../lib/storage', () => ({
  isStorageConfigured: vi.fn(() => true),
  createUploadUrl: vi.fn(async ({ storageKey }: { storageKey: string }) => ({ url: `https://mock-r2.example/upload/${storageKey}`, expiresAt: new Date(Date.now() + 300000) })),
  createDownloadUrl: vi.fn(async ({ storageKey }: { storageKey: string }) => ({ url: `https://mock-r2.example/download/${storageKey}`, expiresAt: new Date(Date.now() + 300000) })),
  headObject: vi.fn(async () => null),
}));
vi.mock('../lib/translation', () => ({ translateAndStoreUpdatePost: vi.fn(async () => {}) }));

import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { bootstrap } from './testUtils';
import { createAdmin } from './helpers';

// A post can be for "Everyone" or for "Friends" only: only the author's friends (and the author,
// and the moderators) can see it, in the feed, on the author's profile, by id, and its pictures.

const app = createApp();
let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.119.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', ip);
  return wrapped;
}
type Agent = ReturnType<typeof agentWithUniqueIp>;

let n = 0;
async function member(name: string) {
  n += 1;
  const whatsapp = `+2376708${String(n).padStart(5, '0')}`;
  const person = await prisma.person.create({ data: { name, whatsappNumber: whatsapp } });
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  const ra = agentWithUniqueIp();
  const { csrf: rc } = await bootstrap(ra as never);
  await ra.post('/api/member/auth/request-link').set('X-CSRF-Token', rc).send({ whatsapp, email: `aud${n}@example.com` });
  const link = spy.mock.calls[spy.mock.calls.length - 1][0].link as string;
  spy.mockRestore();
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as never);
  await agent.post('/api/member/auth/consume').set('X-CSRF-Token', csrf).send({ token: new URL(link).searchParams.get('token') });
  return { agent, csrf, id: person.id };
}
const befriend = (a: string, b: string) => prisma.friendship.create({ data: { requesterPersonId: a, addresseePersonId: b, status: 'ACCEPTED' } });
const post = (who: { agent: Agent; csrf: string }, body: Record<string, unknown>) => who.agent.post('/api/updates').set('X-CSRF-Token', who.csrf).send(body);
const ids = async (who: { agent: Agent }, query = '') => (await who.agent.get(`/api/updates${query}`)).body.items.map((i: { id: string }) => i.id) as string[];

describe('Posts for friends only', () => {
  it('a post is for everyone unless its author chooses Friends', async () => {
    const ada = await member('Ada');
    const open = await post(ada, { body: 'Hello all' });
    expect(open.status).toBe(201);
    const list = await ada.agent.get('/api/updates');
    expect(list.body.items[0]).toMatchObject({ id: open.body.id, audience: 'EVERYONE' });
    expect((await post(ada, { body: 'x', audience: 'NOBODY' })).status).toBe(400);
  });

  it('only the author and the author’s friends see a Friends post: feed, profile, reactions, comments', async () => {
    const ada = await member('Ada');
    const ben = await member('Ben');
    const cora = await member('Cora');
    await befriend(ada.id, ben.id);
    const everyone = (await post(ada, { body: 'For everyone', audience: 'EVERYONE' })).body.id as string;
    const friendsPost = (await post(ada, { body: 'Just for friends', audience: 'FRIENDS' })).body.id as string;

    expect(await ids(ada)).toEqual(expect.arrayContaining([everyone, friendsPost]));
    expect(await ids(ben)).toEqual(expect.arrayContaining([everyone, friendsPost]));
    expect(await ids(cora)).toContain(everyone);
    expect(await ids(cora)).not.toContain(friendsPost);
    // Ada's profile, seen by Cora, shows only what is for everyone.
    expect(await ids(cora, `?authorPersonId=${ada.id}`)).toEqual([everyone]);
    expect(await ids(ben, `?authorPersonId=${ada.id}`)).toEqual(expect.arrayContaining([everyone, friendsPost]));

    // A stranger cannot react to it, read its reactions, read or write comments on it, or count it.
    const react = (who: typeof cora) => who.agent.put(`/api/updates/${friendsPost}/reaction`).set('X-CSRF-Token', who.csrf).send({ type: 'LIKE' });
    expect((await react(cora)).status).toBe(404);
    expect((await cora.agent.get(`/api/updates/${friendsPost}/reactions`)).status).toBe(404);
    expect((await cora.agent.get(`/api/updates/${friendsPost}/comments`)).status).toBe(404);
    expect((await cora.agent.post(`/api/updates/${friendsPost}/comments`).set('X-CSRF-Token', cora.csrf).send({ body: 'hi' })).status).toBe(404);
    expect((await cora.agent.get(`/api/updates/reaction-counts?ids=${friendsPost},${everyone}`)).body.items).not.toHaveProperty(friendsPost);
    // A friend can.
    expect((await react(ben)).status).toBe(200);
    expect((await ben.agent.post(`/api/updates/${friendsPost}/comments`).set('X-CSRF-Token', ben.csrf).send({ body: 'Amen' })).status).toBe(201);
    await new Promise((r) => setTimeout(r, 400)); // let the notifications those two actions send finish before the next test clears the tables
  });

  it('its pictures are only for friends too, and the photo wall leaves them out for others', async () => {
    const ada = await member('Ada');
    const ben = await member('Ben');
    const cora = await member('Cora');
    await befriend(ada.id, ben.id);
    const mk = async (audience: string) => {
      const p = await prisma.updatePost.create({ data: { authorPersonId: ada.id, body: audience, audience: audience as never } });
      return prisma.updatePostPhoto.create({ data: { postId: p.id, storageKey: `updates/${ada.id}/${audience}.jpg`, mimeType: 'image/jpeg', byteSize: 10, position: 0 } });
    };
    const open = await mk('EVERYONE');
    const closed = await mk('FRIENDS');
    expect((await cora.agent.get(`/api/updates/photos/${open.id}`)).status).toBe(302);
    expect((await cora.agent.get(`/api/updates/photos/${closed.id}`)).status).toBe(404);
    expect((await ben.agent.get(`/api/updates/photos/${closed.id}`)).status).toBe(302);
    expect((await cora.agent.get(`/api/updates/photo-wall?authorPersonId=${ada.id}`)).body.items.map((i: { id: string }) => i.id)).toEqual([open.id]);
    expect((await ben.agent.get(`/api/updates/photo-wall?authorPersonId=${ada.id}`)).body.items).toHaveLength(2);
  });

  it('the central admin (moderator) still sees every post', async () => {
    const ada = await member('Ada');
    const friendsPost = (await post(ada, { body: 'Just for friends', audience: 'FRIENDS' })).body.id as string;
    const email = 'aud-admin@test.local';
    await createAdmin(email, 'AdminPass123!');
    const admin = agentWithUniqueIp();
    const { csrf } = await bootstrap(admin as never);
    await admin.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'AdminPass123!' });
    expect(await ids({ agent: admin })).toContain(friendsPost);
  });
});
