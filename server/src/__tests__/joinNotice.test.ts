import { describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { bootstrap } from './testUtils';
import { announceJoined, MAX_NAMED_JOINS } from '../lib/joinNotice';
import { addPeopleToCommunity } from '../lib/bulkMembers';
import { getCommunityConversationUnreadCount, getOrCreateConversation } from '../lib/communityConversation';

// "Just joined": the chat shows a line with the person's name when they join, never when they leave.
const app = createApp();
const PASSWORD = 'GoodPass123!';
let n = 0;
const person = (name: string) => prisma.person.create({ data: { name: `${name} ${++n}`, whatsappNumber: `+2378500${String(n).padStart(5, '0')}` } });

function agentWithIp() {
  n += 1;
  const raw = request.agent(app);
  const ip = `10.221.${Math.floor(n / 256) % 256}.${n % 256}`;
  const methods = ['get', 'post', 'patch'] as const;
  const w = {} as Record<(typeof methods)[number], (p: string) => request.Test>;
  for (const m of methods) w[m] = (p: string) => raw[m](p).set('X-Forwarded-For', ip);
  return w;
}

async function adminAgent() {
  const adminPerson = await person('Founder');
  const adminUser = await prisma.user.create({ data: { name: 'Founder', email: `jn-${++n}@test.local`, passwordHash: await bcrypt.hash(PASSWORD, 4), role: 'ADMIN', personId: adminPerson.id } });
  const agent = agentWithIp();
  const { csrf } = await bootstrap(agent as any);
  expect((await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: adminUser.email, password: PASSWORD })).status).toBe(200);
  return { agent, csrf, adminPerson };
}
const joinedLines = async (communityId: string) =>
  prisma.message.findMany({ where: { conversation: { communityId }, kind: 'JOINED' }, orderBy: { createdAt: 'asc' } });

describe('The "just joined" line', () => {
  it('writes one line per person, in the name of the person who joined, with no text', async () => {
    const community = await prisma.community.create({ data: { name: `JoinA ${++n}` } });
    const a = await person('Ada');
    const b = await person('Ben');
    await announceJoined(community.id, [a.id, b.id]);
    const lines = await joinedLines(community.id);
    expect(lines.map((l) => l.senderPersonId).sort()).toEqual([a.id, b.id].sort());
    expect(lines.every((l) => l.body === null)).toBe(true);
  });

  it('many added at once become one line with the number; the same person is not announced twice in a minute; the central admin is never announced', async () => {
    const { adminPerson } = await adminAgent();
    const community = await prisma.community.create({ data: { name: `JoinB ${++n}` } });
    const many = [];
    for (let i = 0; i < MAX_NAMED_JOINS + 3; i++) many.push((await person('Bulk')).id);
    await announceJoined(community.id, many);
    const lines = await joinedLines(community.id);
    expect(lines).toHaveLength(1);
    expect(lines[0].body).toBe(String(MAX_NAMED_JOINS + 3));
    const solo = await person('Solo');
    await announceJoined(community.id, [solo.id]);
    await announceJoined(community.id, [solo.id]);
    await announceJoined(community.id, [adminPerson.id]);
    expect((await joinedLines(community.id)).filter((l) => l.senderPersonId === solo.id)).toHaveLength(1);
    expect((await joinedLines(community.id)).some((l) => l.senderPersonId === adminPerson.id)).toBe(false);
  });

  it('is never counted as unread, and the chat sends it marked as a joined line', async () => {
    const community = await prisma.community.create({ data: { name: `JoinC ${++n}` } });
    const conversation = await getOrCreateConversation(community.id);
    const watcher = await person('Watcher');
    const newcomer = await person('Newcomer');
    await prisma.communityMembership.create({ data: { personId: watcher.id, communityId: community.id } });
    await announceJoined(community.id, [newcomer.id]);
    expect(await getCommunityConversationUnreadCount(watcher.id, conversation.id, community.id)).toBe(0);
    await prisma.message.create({ data: { conversationId: conversation.id, senderPersonId: newcomer.id, body: 'Hello all' } });
    expect(await getCommunityConversationUnreadCount(watcher.id, conversation.id, community.id)).toBe(1);
  });

  it('shows up when the admin adds someone, and again when someone is added in bulk, but nothing is written when they leave', async () => {
    const { agent, csrf } = await adminAgent();
    const community = await prisma.community.create({ data: { name: `JoinD ${++n}` } });
    const p = await person('Added');
    const res = await agent.post(`/api/admin/people/${p.id}/community-memberships`).set('X-CSRF-Token', csrf).send({ communityId: community.id });
    expect(res.status).toBe(201);
    await new Promise((r) => setTimeout(r, 300));
    expect((await joinedLines(community.id)).map((l) => l.senderPersonId)).toEqual([p.id]);

    // Leaving: the membership is switched off, and no line appears.
    const off = await agent.patch(`/api/admin/community-memberships/${res.body.id}`).set('X-CSRF-Token', csrf).send({ status: 'INACTIVE' });
    expect(off.status).toBe(200);
    await new Promise((r) => setTimeout(r, 300));
    expect(await joinedLines(community.id)).toHaveLength(1);

    // Coming back counts as joining again (after the one-minute repeat window).
    await prisma.message.updateMany({ where: { conversation: { communityId: community.id }, kind: 'JOINED' }, data: { createdAt: new Date(Date.now() - 5 * 60 * 1000) } });
    await addPeopleToCommunity([p.id], community.id);
    await new Promise((r) => setTimeout(r, 300));
    expect(await joinedLines(community.id)).toHaveLength(2);
  });

  it('a person who is erased or asked to be deleted is not announced', async () => {
    const community = await prisma.community.create({ data: { name: `JoinE ${++n}` } });
    const gone = await prisma.person.create({ data: { name: `Gone ${++n}`, whatsappNumber: `+2378500${String(n).padStart(5, '0')}`, deletionRequestedAt: new Date() } });
    await announceJoined(community.id, [gone.id]);
    expect(await joinedLines(community.id)).toHaveLength(0);
  });
});
