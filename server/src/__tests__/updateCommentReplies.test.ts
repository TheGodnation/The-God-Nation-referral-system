import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { bootstrap } from './testUtils';

// Updates comments: six reactions with counts, and one-level replies.
const app = createApp();

let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.127.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) {
    wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', ip);
  }
  return wrapped;
}

let n = 0;
async function member(name = 'Commenter') {
  n += 1;
  const email = `cr${n}@example.com`;
  const person = await prisma.person.create({
    data: { name: `${name} ${n}`, whatsappNumber: `+2376557${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() },
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

async function comment(m: M, postId: string, body: string, parentCommentId?: string) {
  return m.agent.post(`/api/updates/${postId}/comments`).set('X-CSRF-Token', m.csrf).send({ body, ...(parentCommentId ? { parentCommentId } : {}) });
}

async function list(m: M, postId: string) {
  return (await m.agent.get(`/api/updates/${postId}/comments`)).body.items as any[];
}

describe('Replies on Updates comments', () => {
  it('a reply is linked to the comment it answers; replying to a reply joins the same thread', async () => {
    const ada = await member('Ada');
    const ben = await member('Ben');
    const post = await prisma.updatePost.create({ data: { authorPersonId: ada.person.id, body: 'Prayer meeting tonight' } });

    const top = await comment(ada, post.id, 'Who is coming?');
    expect(top.status).toBe(201);
    const reply = await comment(ben, post.id, 'I am coming', top.body.id);
    expect(reply.body.parentCommentId).toBe(top.body.id);
    const replyToReply = await comment(ada, post.id, 'Great, Ben!', reply.body.id);
    expect(replyToReply.body.parentCommentId).toBe(top.body.id);

    const items = await list(ada, post.id);
    expect(items.map((c) => [c.body, c.parentCommentId])).toEqual([
      ['Who is coming?', null],
      ['I am coming', top.body.id],
      ['Great, Ben!', top.body.id],
    ]);
  });

  it('cannot reply to a comment on another post, or a removed comment', async () => {
    const ada = await member();
    const p1 = await prisma.updatePost.create({ data: { authorPersonId: ada.person.id, body: 'one' } });
    const p2 = await prisma.updatePost.create({ data: { authorPersonId: ada.person.id, body: 'two' } });
    const other = await comment(ada, p1.id, 'On post one');
    expect((await comment(ada, p2.id, 'Wrong place', other.body.id)).status).toBe(400);

    await prisma.updateComment.update({ where: { id: other.body.id }, data: { deletedAt: new Date() } });
    expect((await comment(ada, p1.id, 'Too late', other.body.id)).status).toBe(400);
  });
});

describe('Reactions on Updates comments', () => {
  it('react, change, see counts, and remove', async () => {
    const ada = await member();
    const ben = await member();
    const post = await prisma.updatePost.create({ data: { authorPersonId: ada.person.id, body: 'Testimony' } });
    const c = await comment(ada, post.id, 'God is good');
    const url = `/api/updates/comments/${c.body.id}/reaction`;

    const r1 = await ben.agent.put(url).set('X-CSRF-Token', ben.csrf).send({ type: 'PRAY' });
    expect(r1.status).toBe(200);
    expect(r1.body).toEqual({ reactionCounts: { PRAY: 1 }, myReaction: 'PRAY' });

    await ada.agent.put(url).set('X-CSRF-Token', ada.csrf).send({ type: 'PRAY' });
    const r2 = await ben.agent.put(url).set('X-CSRF-Token', ben.csrf).send({ type: 'LOVE' });
    expect(r2.body.reactionCounts).toEqual({ PRAY: 1, LOVE: 1 });

    const items = await list(ada, post.id);
    expect(items[0].reactionCounts).toEqual({ PRAY: 1, LOVE: 1 });
    expect(items[0].myReaction).toBe('PRAY');

    const r3 = await ben.agent.delete(url).set('X-CSRF-Token', ben.csrf);
    expect(r3.body).toEqual({ reactionCounts: { PRAY: 1 }, myReaction: null });
  });

  it('rejects unknown reactions and removed comments', async () => {
    const ada = await member();
    const post = await prisma.updatePost.create({ data: { authorPersonId: ada.person.id, body: 'x' } });
    const c = await comment(ada, post.id, 'hello');
    const url = `/api/updates/comments/${c.body.id}/reaction`;
    expect((await ada.agent.put(url).set('X-CSRF-Token', ada.csrf).send({ type: 'ANGRY' })).status).toBe(400);
    await prisma.updateComment.update({ where: { id: c.body.id }, data: { deletedAt: new Date() } });
    expect((await ada.agent.put(url).set('X-CSRF-Token', ada.csrf).send({ type: 'LIKE' })).status).toBe(404);
  });
});
