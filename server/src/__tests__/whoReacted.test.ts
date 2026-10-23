import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';

// "Who reacted": everyone's reactions add up, and tapping them lists who
// reacted with what — group chats, private chats, posts, comments and
// headquarters posts.
const app = createApp();

let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.132.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', ip);
  return wrapped;
}

let n = 0;
async function member(name: string) {
  n += 1;
  const email = `react${n}@example.com`;
  const person = await prisma.person.create({ data: { name: `${name} ${n}`, whatsappNumber: `+2376558${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() } });
  await prisma.memberAccount.create({ data: { personId: person.id, email, passwordHash: await bcrypt.hash('GoodPass123!', 4) } });
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'GoodPass123!' });
  return { agent, csrf, person };
}
type M = Awaited<ReturnType<typeof member>>;
const put = (m: M, path: string, body: Record<string, unknown>) => m.agent.put(path).set('X-CSRF-Token', m.csrf).send(body);

describe('Who reacted', () => {
  it('group chat: three people react, the count adds up and everyone is listed (you first)', async () => {
    const [ada, ben, cy] = [await member('Ada'), await member('Ben'), await member('Cy')];
    const community = await prisma.community.create({ data: { name: `Group ${n}` } });
    for (const p of [ada, ben, cy]) await prisma.communityMembership.create({ data: { personId: p.person.id, communityId: community.id } });
    const conversation = await prisma.conversation.create({ data: { communityId: community.id } });
    const msg = await prisma.message.create({ data: { conversationId: conversation.id, senderPersonId: ada.person.id, body: '🎤 voice note' } });
    const path = `/api/communities/${community.id}/conversation/messages/${msg.id}`;

    await put(ben, `${path}/reaction`, { emoji: '❤️' });
    await put(cy, `${path}/reaction`, { emoji: '❤️' });
    const mine = await put(ada, `${path}/reaction`, { emoji: '🙏' });
    expect(mine.body.reactions).toEqual([
      { emoji: '❤️', count: 2, mine: false },
      { emoji: '🙏', count: 1, mine: true },
    ]);

    const list = await ada.agent.get(`${path}/reactions`);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(3);
    expect(list.body.items[0]).toMatchObject({ name: ada.person.name, reaction: '🙏', isMe: true });
    expect(list.body.items.slice(1).map((r: any) => r.name).sort()).toEqual([ben.person.name, cy.person.name].sort());

    // Someone outside the group can't see it.
    const outsider = await member('Out');
    expect((await outsider.agent.get(`${path}/reactions`)).status).toBe(403);
  });

  it('private chat: both sides are listed', async () => {
    const [ada, ben] = [await member('Ada'), await member('Ben')];
    await prisma.friendship.create({ data: { requesterPersonId: ada.person.id, addresseePersonId: ben.person.id, status: 'ACCEPTED', respondedAt: new Date() } });
    const opened = await ada.agent.post('/api/member/messages/open').set('X-CSRF-Token', ada.csrf).send({ personId: ben.person.id });
    const chatId = opened.body.conversationId ?? opened.body.id;
    const sent = await ada.agent.post(`/api/private-messages/conversations/${chatId}/messages`).set('X-CSRF-Token', ada.csrf).send({ body: 'Photo of the meeting' });
    const path = `/api/private-messages/conversations/${chatId}/messages/${sent.body.id}`;
    await put(ada, `${path}/reaction`, { emoji: '👍' });
    await put(ben, `${path}/reaction`, { emoji: '👍' });
    const list = await ben.agent.get(`${path}/reactions`);
    expect(list.body.total).toBe(2);
    expect(list.body.reactions).toEqual([{ emoji: '👍', count: 2, mine: true }]);
    expect(list.body.items[0]).toMatchObject({ name: ben.person.name, isMe: true });
  });

  it('posts: liking returns everyone’s counts, the feed can refresh them, and the list shows who', async () => {
    const [ada, ben, cy] = [await member('Ada'), await member('Ben'), await member('Cy')];
    const post = await prisma.updatePost.create({ data: { authorPersonId: ada.person.id, body: 'Sunday service photos' } });
    await put(ben, `/api/updates/${post.id}/reaction`, { type: 'LIKE' });
    const res = await put(cy, `/api/updates/${post.id}/reaction`, { type: 'LOVE' });
    expect(res.body).toEqual({ reactionCounts: { LIKE: 1, LOVE: 1 }, myReaction: 'LOVE' });

    const counts = await ada.agent.get(`/api/updates/reaction-counts?ids=${post.id},not-an-id`);
    expect(counts.body.items).toEqual({ [post.id]: { reactionCounts: { LIKE: 1, LOVE: 1 }, myReaction: null } });

    const list = await ada.agent.get(`/api/updates/${post.id}/reactions`);
    expect(list.body.items.map((r: any) => [r.name, r.reaction])).toEqual([
      [cy.person.name, 'LOVE'],
      [ben.person.name, 'LIKE'],
    ]);

    const comment = await prisma.updateComment.create({ data: { postId: post.id, authorPersonId: ben.person.id, body: 'Amen' } });
    await put(ada, `/api/updates/comments/${comment.id}/reaction`, { type: 'PRAY' });
    expect((await cy.agent.get(`/api/updates/comments/${comment.id}/reactions`)).body.items).toMatchObject([{ name: ada.person.name, reaction: 'PRAY', isMe: false }]);
  });

  it('headquarters posts: lists who liked', async () => {
    const admin = await createAdmin(`hq-admin-${++n}@test.local`, 'AdminPass123!');
    const [ada, ben] = [await member('Ada'), await member('Ben')];
    const group = await prisma.community.create({ data: { name: `HQ group ${n}` } });
    for (const p of [ada, ben]) await prisma.communityMembership.create({ data: { personId: p.person.id, communityId: group.id } });
    const post = await prisma.headquartersPost.create({
      data: { titleEn: 'Word', bodyEn: 'Body', createdByUserId: admin.id, publishedAt: new Date(), targets: { create: [{ communityId: group.id }] } },
    });
    await ben.agent.post(`/api/me/headquarters-posts/${post.id}/reaction`).set('X-CSRF-Token', ben.csrf).send({});
    const list = await ada.agent.get(`/api/me/headquarters-posts/${post.id}/reactions`);
    expect(list.status).toBe(200);
    expect(list.body.items).toMatchObject([{ name: ben.person.name, reaction: 'LIKE', isMe: false }]);
  });
});
