import { prisma } from './prisma';

// ---------------------------------------------------------------------------
// The central admin's read-only view of the follow-up chats between a leader
// and the people they follow, so he can see that leaders are doing the work.
// Nothing is written when he reads: no "seen", no notification, no read
// position — the leader and the person are never told. On by default; he can
// switch it off (Settings.adminReadsFollowUpChats). The privacy policy says
// follow-up conversations may be reviewed by the central administration.
// ---------------------------------------------------------------------------

export async function adminReadsEnabled(): Promise<boolean> {
  const s = await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { adminReadsFollowUpChats: true } });
  return s?.adminReadsFollowUpChats ?? true;
}

export async function setAdminReads(enabled: boolean) {
  await prisma.settings.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', adminReadsFollowUpChats: enabled }, update: { adminReadsFollowUpChats: enabled } });
}

export interface LeaderChatRow {
  conversationId: string;
  memberPersonId: string;
  memberName: string;
  messageCount: number;
  lastMessageAt: string | null;
  lastFrom: 'LEADER' | 'MEMBER' | null;
}

/** The chats this leader started with the people they follow. */
export async function chatsOfLeader(leaderPersonId: string): Promise<LeaderChatRow[]> {
  const followed = await prisma.followUpAssignment.findMany({ where: { followerId: leaderPersonId }, select: { followedPersonId: true } });
  const followedIds = new Set(followed.map((f) => f.followedPersonId));
  const conversations = await prisma.privateConversation.findMany({
    where: { initiatorPersonId: leaderPersonId },
    select: { id: true, memberPersonId: true, memberPerson: { select: { name: true } } },
  });
  const rows: LeaderChatRow[] = [];
  for (const c of conversations) {
    if (!followedIds.has(c.memberPersonId)) continue;
    const [count, last] = await Promise.all([
      prisma.privateMessage.count({ where: { conversationId: c.id, deletedAt: null } }),
      prisma.privateMessage.findFirst({ where: { conversationId: c.id, deletedAt: null }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, senderPersonId: true } }),
    ]);
    rows.push({
      conversationId: c.id,
      memberPersonId: c.memberPersonId,
      memberName: c.memberPerson.name,
      messageCount: count,
      lastMessageAt: last?.createdAt.toISOString() ?? null,
      lastFrom: last ? (last.senderPersonId === leaderPersonId ? 'LEADER' : 'MEMBER') : null,
    });
  }
  return rows.sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''));
}

export interface OversightMessage {
  id: string;
  from: 'LEADER' | 'MEMBER';
  senderName: string;
  body: string;
  createdAt: string;
  removed: boolean;
  attachments: { kind: 'VOICE' | 'PHOTO' | 'VIDEO' | 'FILE'; fileName: string }[];
}

const kindOf = (mime: string): 'VOICE' | 'PHOTO' | 'VIDEO' | 'FILE' =>
  mime.startsWith('audio/') ? 'VOICE' : mime.startsWith('image/') ? 'PHOTO' : mime.startsWith('video/') ? 'VIDEO' : 'FILE';

/** A leader–person chat, oldest first, as text. Only chats started by a leader; never a chat between two ordinary members. */
export async function readLeaderChat(conversationId: string, limit = 300) {
  const conversation = await prisma.privateConversation.findUnique({
    where: { id: conversationId },
    select: { id: true, initiatorPersonId: true, memberPersonId: true, initiatorPerson: { select: { name: true } }, memberPerson: { select: { name: true } } },
  });
  if (!conversation || !conversation.initiatorPersonId) return null;
  const messages = await prisma.privateMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, senderPersonId: true, body: true, createdAt: true, deletedAt: true, attachments: { select: { originalFilename: true, mimeType: true } } },
  });
  messages.reverse();
  return {
    leaderPersonId: conversation.initiatorPersonId,
    leaderName: conversation.initiatorPerson?.name ?? '',
    memberPersonId: conversation.memberPersonId,
    memberName: conversation.memberPerson.name,
    messages: messages.map<OversightMessage>((m) => {
      const fromLeader = m.senderPersonId === conversation.initiatorPersonId;
      return {
        id: m.id,
        from: fromLeader ? 'LEADER' : 'MEMBER',
        senderName: fromLeader ? (conversation.initiatorPerson?.name ?? '') : conversation.memberPerson.name,
        body: m.deletedAt ? '' : m.body,
        createdAt: m.createdAt.toISOString(),
        removed: Boolean(m.deletedAt),
        attachments: m.deletedAt ? [] : m.attachments.map((a) => ({ kind: kindOf(a.mimeType), fileName: a.originalFilename })),
      };
    }),
  };
}
