import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { prisma } from '../lib/prisma';
import { createAdmin } from './helpers';

// Follow-up moved into the normal private chat. This runs the migration that
// copies the old text-only follow-up conversations into those private chats.
const SQL = fs.readFileSync(path.resolve(__dirname, '../../prisma/migrations/20261104090000_followup_history_to_private_chat/migration.sql'), 'utf8');

async function runMigration() {
  const statements = SQL.split(/;\s*$/m).map((s) => s.replace(/^--.*$/gm, '').trim()).filter(Boolean);
  for (const st of statements) await prisma.$executeRawUnsafe(st);
}

describe('old follow-up conversations are copied into private chats', () => {
  it('keeps every message, its sender and time, and leaves the old rows alone', async () => {
    const admin = await createAdmin();
    const leader = await prisma.person.create({ data: { name: 'Leader', whatsappNumber: '+237699100001' } });
    const member = await prisma.person.create({ data: { name: 'Member', whatsappNumber: '+237699100002' } });
    const hq = await prisma.community.create({ data: { name: 'HQ' } });
    const a = await prisma.followUpAssignment.create({
      data: { followerId: leader.id, followedPersonId: member.id, contextType: 'COMMUNITY', contextId: hq.id, assignedByUserId: admin.id },
    });
    const conv = await prisma.followUpConversation.create({ data: { followUpAssignmentId: a.id } });
    const t0 = new Date('2026-10-01T08:00:00Z');
    await prisma.followUpMessage.create({ data: { conversationId: conv.id, senderPersonId: leader.id, body: 'How are you?', createdAt: t0 } });
    await prisma.followUpMessage.create({ data: { conversationId: conv.id, senderPersonId: member.id, body: 'Well, thank you.', createdAt: new Date(t0.getTime() + 60000) } });

    await runMigration();

    const chat = await prisma.privateConversation.findUniqueOrThrow({
      where: { memberPersonId_initiatorPersonId: { memberPersonId: member.id, initiatorPersonId: leader.id } },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    expect(chat.messages.map((m) => [m.senderPersonId, m.body])).toEqual([
      [leader.id, 'How are you?'],
      [member.id, 'Well, thank you.'],
    ]);
    expect(chat.messages[0].createdAt.toISOString()).toBe(t0.toISOString());
    expect(await prisma.followUpMessage.count()).toBe(2);
  });

  it('adds to a private chat that already exists instead of making a second one', async () => {
    const admin = await createAdmin();
    const leader = await prisma.person.create({ data: { name: 'Leader', whatsappNumber: '+237699100011' } });
    const member = await prisma.person.create({ data: { name: 'Member', whatsappNumber: '+237699100012' } });
    const hq = await prisma.community.create({ data: { name: 'HQ' } });
    const existing = await prisma.privateConversation.create({ data: { memberPersonId: member.id, initiatorPersonId: leader.id } });
    await prisma.privateMessage.create({ data: { conversationId: existing.id, senderPersonId: leader.id, body: 'Earlier private message' } });
    const a = await prisma.followUpAssignment.create({
      data: { followerId: leader.id, followedPersonId: member.id, contextType: 'COMMUNITY', contextId: hq.id, assignedByUserId: admin.id },
    });
    const conv = await prisma.followUpConversation.create({ data: { followUpAssignmentId: a.id } });
    await prisma.followUpMessage.create({ data: { conversationId: conv.id, senderPersonId: member.id, body: 'Old follow-up reply' } });

    await runMigration();

    expect(await prisma.privateConversation.count()).toBe(1);
    expect(await prisma.privateMessage.count({ where: { conversationId: existing.id } })).toBe(2);
  });

  it('does nothing when there is no old history', async () => {
    await runMigration();
    expect(await prisma.privateConversation.count()).toBe(0);
  });
});
