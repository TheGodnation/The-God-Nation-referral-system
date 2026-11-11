import { prisma } from './prisma';
import { listLeaders } from './leaderInstructions';
import { getOrCreatePrivateConversation } from './privateMessaging';
import { notifyPrivateMessageReceived } from './notifications';
import { MAX_ATTACHMENTS_PER_MESSAGE, generatePrivateAttachmentStorageKey, isAllowedAttachmentMime, isValidOriginalFilename, maxBytesForMime } from './attachmentPolicy';
import { copyObject, deleteObject, headObject, isStorageConfigured } from './storage';
import { MAX_MESSAGE_CHARS } from './textLimits';
import { isCentralAdminPerson } from './centralAdmin';

// "Message all my people": a leader writes once (text, photos, a voice message) and each person they look after gets
// it as an ordinary private message from the leader, in their normal private chat, opening with a greeting from The God Nation (no names).
// There is no limit on how many a leader sends. A record is kept for the central admin and the representatives.

export const BROADCAST_GREETING_EN = 'Hello, greetings from The God Nation 🙏';
export const BROADCAST_GREETING_FR = 'Bonjour, salutations de The God Nation 🙏';

export class BroadcastError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const STAGING_PATTERN = /^private-broadcasts\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/;
const MAX_PEOPLE = 1000;

export function generateStagingKey(leaderPersonId: string): string {
  return `private-broadcasts/${leaderPersonId}/${crypto.randomUUID()}`;
}

export async function requireLeaderPerson(personId: string) {
  const role = await prisma.roleAssignment.findFirst({ where: { personId, roleType: 'SCOPED_LEADER', status: 'ACTIVE' }, select: { id: true } });
  if (!role) throw new BroadcastError('Only leaders can message their people.', 403);
}

/** The people this leader looks after: their active follow-ups, whose accounts still exist. */
export async function peopleOf(leaderPersonId: string) {
  const rows = await prisma.followUpAssignment.findMany({
    where: { followerId: leaderPersonId, status: 'ACTIVE', followedPerson: { erasedAt: null } },
    select: { followedPerson: { select: { id: true, name: true } } },
    distinct: ['followedPersonId'],
    orderBy: { followedPerson: { name: 'asc' } },
  });
  return rows.map((r) => r.followedPerson);
}

export interface AttachmentInput {
  storageKey: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  thumb?: string;
  pageCount?: number;
}

export interface BroadcastInput {
  personIds?: string[];
  body?: string;
  attachments?: AttachmentInput[];
}

function cleanText(input: BroadcastInput): { text: string; attachments: AttachmentInput[] } {
  const text = (input.body ?? '').trim();
  const attachments = input.attachments ?? [];
  if (!text && attachments.length === 0) throw new BroadcastError('Write a message or add a photo or a voice message.');
  if (text.length > MAX_MESSAGE_CHARS) throw new BroadcastError('The message is too long.');
  if (attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) throw new BroadcastError('Too many files in one message.');
  return { text, attachments };
}

/** Photos / voice messages were uploaded once to a staging place; each recipient gets its own copy. */
async function checkAttachments(senderPersonId: string, attachments: AttachmentInput[]) {
  if (attachments.length === 0) return;
  if (!isStorageConfigured()) throw new BroadcastError('Photos and voice messages are not available right now.', 503);
  const seen = new Set<string>();
  for (const a of attachments) {
    const match = STAGING_PATTERN.exec(a.storageKey);
    if (!match || match[1] !== senderPersonId || seen.has(a.storageKey)) throw new BroadcastError('Invalid attachment reference.');
    seen.add(a.storageKey);
    if (!isAllowedAttachmentMime(a.mimeType)) throw new BroadcastError('Unsupported attachment type.');
    if (a.byteSize > maxBytesForMime(a.mimeType)!) throw new BroadcastError('Attachment is too large.');
    if (!isValidOriginalFilename(a.originalFilename)) throw new BroadcastError('Invalid attachment filename.');
    const head = await headObject({ storageKey: a.storageKey });
    if (!head || head.contentLength !== a.byteSize || (head.contentType && head.contentType !== a.mimeType)) {
      throw new BroadcastError('Attachment upload could not be verified.');
    }
  }
}

/** Sends the message to each person as an ordinary private message from the sender, and keeps the record. */
async function deliver(senderPersonId: string, chosenIds: string[], text: string, attachments: AttachmentInput[], via?: string) {
  const languages = await prisma.person.findMany({ where: { id: { in: chosenIds } }, select: { id: true, preferredLanguage: true } });
  const langOf = new Map(languages.map((l) => [l.id, l.preferredLanguage]));

  let sent = 0;
  let skipped = 0;
  for (const personId of chosenIds) {
    try {
      const conversation = await getOrCreatePrivateConversation(personId, { type: 'PERSON', personId: senderPersonId });
      // The same greeting for everyone, with no name in it, in the person's own language.
      const greeting = String(langOf.get(personId)).startsWith('fr') ? BROADCAST_GREETING_FR : BROADCAST_GREETING_EN;
      const copies: { storageKey: string; a: AttachmentInput }[] = [];
      for (const a of attachments) {
        const destKey = generatePrivateAttachmentStorageKey(conversation.id);
        await copyObject({ sourceKey: a.storageKey, destKey });
        copies.push({ storageKey: destKey, a });
      }
      await prisma.privateMessage.create({
        data: {
          conversationId: conversation.id,
          senderPersonId,
          body: text ? `${greeting}\n\n${text}` : greeting,
          attachments: copies.length
            ? { create: copies.map(({ storageKey, a }) => ({ storageKey, originalFilename: a.originalFilename, mimeType: a.mimeType, byteSize: a.byteSize, thumbDataUrl: a.thumb ?? null, pageCount: a.pageCount ?? null })) }
            : undefined,
        },
      });
      await notifyPrivateMessageReceived(conversation, { type: 'PERSON', personId: senderPersonId }).catch(() => {});
      sent++;
    } catch (err) {
      skipped++;
      console.error('[broadcast] could not send to one person', { via, error: err instanceof Error ? err.message : String(err) });
    }
  }
  for (const a of attachments) await deleteObject({ storageKey: a.storageKey }).catch(() => {});

  const record = await prisma.leaderBroadcast.create({ data: { senderPersonId, body: text, recipientCount: sent, skippedCount: skipped, attachmentCount: attachments.length } });
  return { id: record.id, recipients: sent, skipped };
}

export async function sendBroadcast(leaderPersonId: string, input: BroadcastInput) {
  await requireLeaderPerson(leaderPersonId);
  const { text, attachments } = cleanText(input);

  const everyone = await peopleOf(leaderPersonId);
  const wanted = input.personIds ? new Set(input.personIds) : null;
  if (wanted) {
    const known = new Set(everyone.map((p) => p.id));
    if ([...wanted].some((id) => !known.has(id))) throw new BroadcastError('You can only message the people you look after.', 403);
  }
  const chosen = wanted ? everyone.filter((p) => wanted.has(p.id)) : everyone;
  if (chosen.length === 0) throw new BroadcastError('There is nobody to send this to.');
  if (chosen.length > MAX_PEOPLE) throw new BroadcastError(`Too many people at once (${MAX_PEOPLE} at most).`);
  await checkAttachments(leaderPersonId, attachments);
  return deliver(leaderPersonId, chosen.map((p) => p.id), text, attachments);
}

/**
 * The National Coordinator writes once to any people they choose (not only the ones they follow up). Each person gets an
 * ordinary private message from the coordinator, who shows with the "National Coordinator" label.
 */
export async function sendCoordinatorMessage(adminPersonId: string, input: BroadcastInput) {
  if (!(await isCentralAdminPerson(adminPersonId))) throw new BroadcastError('Only the central admin can message everyone this way.', 403);
  const { text, attachments } = cleanText(input);
  const wanted = [...new Set(input.personIds ?? [])];
  if (wanted.length === 0) throw new BroadcastError('Choose who to send this to.');
  if (wanted.length > MAX_PEOPLE) throw new BroadcastError(`Too many people at once (${MAX_PEOPLE} at most).`);
  const real = await prisma.person.findMany({ where: { id: { in: wanted }, erasedAt: null, deletionRequestedAt: null, NOT: { id: adminPersonId } }, select: { id: true } });
  const chosen = real.map((p) => p.id);
  if (chosen.length === 0) throw new BroadcastError('There is nobody to send this to.');
  await checkAttachments(adminPersonId, attachments);
  return deliver(adminPersonId, chosen, text, attachments, 'coordinator');
}

/** The record of group messages: a leader's own, a generation's leaders', or everyone's (central admin). */
export async function broadcastLog(opts: { senderPersonIds?: string[] | null } = {}) {
  const rows = await prisma.leaderBroadcast.findMany({
    where: opts.senderPersonIds ? { senderPersonId: { in: opts.senderPersonIds } } : {},
    include: { sender: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return rows.map((r) => ({ id: r.id, senderPersonId: r.senderPersonId, senderName: r.sender.name, body: r.body, recipientCount: r.recipientCount, skippedCount: r.skippedCount, attachmentCount: r.attachmentCount, createdAt: r.createdAt }));
}

/** The leaders a representative may read the log of: those of their own generation. */
export async function leaderIdsOfGeneration(generation: number): Promise<string[]> {
  return (await listLeaders()).filter((l) => l.generations.includes(generation)).map((l) => l.personId);
}
