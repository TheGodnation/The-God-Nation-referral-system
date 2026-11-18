import { describe, it, expect } from 'vitest';
import { prisma } from '../lib/prisma';
import { findSplitChats, joinChats } from '../lib/joinChats';

// Two people with two private chats between them (one started by each): found, and joined into the older one with every
// message in time order and each person's read mark kept.
let n = 0;
async function person(name: string) {
  n += 1;
  return prisma.person.create({ data: { name: `${name} ${n}`, whatsappNumber: `+2376771${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() } });
}

describe('joining split chats', () => {
  it('finds a split pair, joins it into the older chat, keeps every message and the later read mark, and removes the other chat', async () => {
    const a = await person('Split A');
    const b = await person('Split B');
    const older = await prisma.privateConversation.create({ data: { memberPersonId: b.id, initiatorPersonId: a.id, createdAt: new Date('2026-01-01T10:00:00Z') } });
    const newer = await prisma.privateConversation.create({ data: { memberPersonId: a.id, initiatorPersonId: b.id, createdAt: new Date('2026-06-01T10:00:00Z') } });
    await prisma.privateMessage.createMany({
      data: [
        { conversationId: older.id, senderPersonId: a.id, body: 'old 1', createdAt: new Date('2026-01-01T10:01:00Z') },
        { conversationId: older.id, senderPersonId: b.id, body: 'old 2', createdAt: new Date('2026-01-01T10:02:00Z') },
        { conversationId: newer.id, senderPersonId: b.id, body: 'new 1', createdAt: new Date('2026-06-01T10:01:00Z') },
      ],
    });
    await prisma.privateConversationRead.create({ data: { conversationId: older.id, personId: a.id, lastReadAt: new Date('2026-01-02T00:00:00Z') } });
    await prisma.privateConversationRead.create({ data: { conversationId: newer.id, personId: a.id, lastReadAt: new Date('2026-06-02T00:00:00Z') } });

    const found = (await findSplitChats()).find((s) => s.keepId === older.id);
    expect(found).toMatchObject({ keepId: older.id, dropId: newer.id, keepMessages: 2, dropMessages: 1 });
    expect([found!.personA.id, found!.personB.id].sort()).toEqual([a.id, b.id].sort());

    const res = await joinChats(older.id, newer.id);
    expect(res).toEqual({ ok: true, keepId: older.id, movedMessages: 1 });

    const msgs = await prisma.privateMessage.findMany({ where: { conversationId: older.id }, orderBy: { createdAt: 'asc' } });
    expect(msgs.map((m) => m.body)).toEqual(['old 1', 'old 2', 'new 1']);
    expect(await prisma.privateConversation.findUnique({ where: { id: newer.id } })).toBeNull();
    const reads = await prisma.privateConversationRead.findMany({ where: { conversationId: older.id } });
    expect(reads).toHaveLength(1);
    expect(reads[0].lastReadAt.toISOString()).toBe('2026-06-02T00:00:00.000Z');
    expect((await findSplitChats()).some((s) => s.keepId === older.id)).toBe(false);
  });

  it('refuses to join chats that are not the same two people', async () => {
    const a = await person('Not A');
    const b = await person('Not B');
    const c = await person('Not C');
    const one = await prisma.privateConversation.create({ data: { memberPersonId: b.id, initiatorPersonId: a.id } });
    const two = await prisma.privateConversation.create({ data: { memberPersonId: c.id, initiatorPersonId: a.id } });
    const res = await joinChats(one.id, two.id);
    expect(res.ok).toBe(false);
    expect(await prisma.privateConversation.findUnique({ where: { id: two.id } })).not.toBeNull();
  });
});
