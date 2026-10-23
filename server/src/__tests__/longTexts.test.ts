import { describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { bootstrap } from './testUtils';
import { MAX_COMMENT_CHARS, MAX_MESSAGE_CHARS, MAX_POST_CHARS } from '../lib/textLimits';

// Long texts go through whole: posts up to 63,206 characters, comments up
// to 8,000, messages (including a first message to someone) up to 65,536.
const app = createApp();
let n = 0;

async function member(name: string) {
  n += 1;
  const email = `long${n}@example.com`;
  const person = await prisma.person.create({ data: { name: `${name} ${n}`, whatsappNumber: `+2376559${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() } });
  await prisma.memberAccount.create({ data: { personId: person.id, email, passwordHash: await bcrypt.hash('GoodPass123!', 4) } });
  const raw = request.agent(app);
  const ip = `10.133.0.${n}`;
  const agent = { get: (p: string) => raw.get(p).set('X-Forwarded-For', ip), post: (p: string) => raw.post(p).set('X-Forwarded-For', ip) };
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'GoodPass123!' });
  return { agent, csrf, person };
}

describe('Long texts', () => {
  it('a long post and comment go through whole; one character too many is refused', async () => {
    const ada = await member('Ada');
    const post = await ada.agent.post('/api/updates').set('X-CSRF-Token', ada.csrf).send({ body: 'p'.repeat(MAX_POST_CHARS) });
    expect(post.status).toBe(201);
    expect((await prisma.updatePost.findFirst({ where: { authorPersonId: ada.person.id } }))?.body).toHaveLength(MAX_POST_CHARS);
    expect((await ada.agent.post('/api/updates').set('X-CSRF-Token', ada.csrf).send({ body: 'p'.repeat(MAX_POST_CHARS + 1) })).status).toBe(400);

    const postId = post.body.id;
    expect((await ada.agent.post(`/api/updates/${postId}/comments`).set('X-CSRF-Token', ada.csrf).send({ body: 'c'.repeat(MAX_COMMENT_CHARS) })).status).toBe(201);
    expect((await ada.agent.post(`/api/updates/${postId}/comments`).set('X-CSRF-Token', ada.csrf).send({ body: 'c'.repeat(MAX_COMMENT_CHARS + 1) })).status).toBe(400);
  });

  it('a long first message to a friend goes through whole', async () => {
    const [ada, ben] = [await member('Ada'), await member('Ben')];
    await prisma.friendship.create({ data: { requesterPersonId: ada.person.id, addresseePersonId: ben.person.id, status: 'ACCEPTED', respondedAt: new Date() } });
    const res = await ada.agent.post('/api/member/messages/start').set('X-CSRF-Token', ada.csrf).send({ personId: ben.person.id, body: 'm'.repeat(10000) });
    expect([200, 201]).toContain(res.status);
    expect((await prisma.privateMessage.findFirst({ where: { senderPersonId: ada.person.id } }))?.body).toHaveLength(10000);
    expect(MAX_MESSAGE_CHARS).toBe(65536);
  });
});
