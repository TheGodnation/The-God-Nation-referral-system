import { prisma } from './prisma';
import { badgeOf, centralAdminAmong } from './centralAdmin';
import { cardStatesFor } from './teachings';

// ---------------------------------------------------------------------------
// Pinned messages. The central admin can pin as many messages as they like at
// the top of an assembly's chat (one by one, or many at once from the chat's
// selection bar). Everyone in the assembly sees them first, however
// many messages come after, and a newcomer sees them whatever their age (they
// are shown from this list, not from the chat's history window). A pin the
// viewer has not looked at yet is "unseen": the app shows the gold "Important
// message, tap to read" chip for it until they open it.
// ---------------------------------------------------------------------------

/** The most messages one request may pin or unpin together (the chat's selection). */
export const MAX_PINS_PER_REQUEST = 300;
// The list of pins carries only the start of each message; the reader fetches the whole one (pinFull).
const PREVIEW_CHARS = 600;

export interface PinView {
  messageId: string;
  senderName: string;
  senderPersonId: string;
  senderBadge: 'NATIONAL_COORDINATOR' | null;
  body: string | null;
  /** The message is longer than what the list carries: the reader fetches the rest. */
  bodyTruncated: boolean;
  translation: { sourceLanguage: 'en' | 'fr'; translatedBody: string } | null;
  teachingTitle: string | null;
  /** The teaching this message carries (the pinned page opens its reading and quiz). */
  teachingId: string | null;
  /** The viewer is done with it: a teaching's quiz taken, or a post opened and read. */
  done: boolean;
  /** How many comments (replies) the post has. */
  commentCount: number;
  attachmentMimeType: string | null;
  createdAt: Date;
  pinnedAt: Date;
  unseen: boolean;
}

/** The assembly's pinned messages as one viewer sees them, newest pin first. */
export async function pinsFor(conversationId: string, viewerPersonId: string, viewerLanguage: 'en' | 'fr' | null): Promise<PinView[]> {
  const pins = await prisma.messagePin.findMany({
    where: { conversationId, message: { deletedAt: null, NOT: { hiddenFor: { some: { personId: viewerPersonId } } } } },
    orderBy: { pinnedAt: 'desc' },
    include: {
      message: {
        select: {
          senderPersonId: true,
          body: true,
          createdAt: true,
          detectedLanguage: true,
          translatedBody: true,
          sender: { select: { name: true } },
          attachments: { select: { mimeType: true }, take: 1 },
          teaching: { select: { id: true, assessmentId: true, title: true, titleTranslated: true, detectedLanguage: true } },
          _count: { select: { replies: { where: { deletedAt: null } } } },
        },
      },
      seen: { where: { personId: viewerPersonId }, select: { id: true } },
    },
  });
  const coordinators = await centralAdminAmong(pins.map((p) => p.message.senderPersonId));
  const states = await cardStatesFor(viewerPersonId, pins.flatMap((p) => (p.message.teaching ? [p.message.teaching] : [])));
  return pins.map((p) => {
    const m = p.message;
    const translated = viewerLanguage && m.detectedLanguage && m.detectedLanguage !== viewerLanguage && m.translatedBody ? { sourceLanguage: m.detectedLanguage, translatedBody: m.translatedBody.slice(0, PREVIEW_CHARS) } : null;
    const teachingTitle = m.teaching
      ? m.teaching.titleTranslated && m.teaching.detectedLanguage && viewerLanguage && m.teaching.detectedLanguage !== viewerLanguage
        ? m.teaching.titleTranslated
        : m.teaching.title
      : null;
    return {
      messageId: p.messageId,
      senderName: m.sender.name,
      senderPersonId: m.senderPersonId,
      senderBadge: badgeOf(coordinators, m.senderPersonId),
      body: m.body ? m.body.slice(0, PREVIEW_CHARS) : null,
      bodyTruncated: Boolean(m.body && m.body.length > PREVIEW_CHARS) || Boolean(translated && m.translatedBody && m.translatedBody.length > PREVIEW_CHARS),
      translation: translated,
      teachingTitle,
      teachingId: m.teaching?.id ?? null,
      done: m.teaching ? ['PASSED', 'FAILED'].includes(states.get(m.teaching.id)?.state ?? 'NEW') : p.pinnedByPersonId === viewerPersonId || p.seen.length > 0,
      commentCount: m._count.replies,
      attachmentMimeType: m.attachments[0]?.mimeType ?? null,
      createdAt: m.createdAt,
      pinnedAt: p.pinnedAt,
      // Nobody is nudged about a message they pinned themselves.
      unseen: p.pinnedByPersonId !== viewerPersonId && p.seen.length === 0,
    };
  });
}

export type PinResult = { ok: true } | { ok: false; status: 404 | 409; error: string };

/** Pins a message of this assembly (safe to repeat). There is no limit on how many are pinned. */
export async function pinMessage(conversationId: string, messageId: string, byPersonId: string): Promise<PinResult> {
  const message = await prisma.message.findUnique({ where: { id: messageId }, select: { conversationId: true, deletedAt: true } });
  if (!message || message.conversationId !== conversationId || message.deletedAt) return { ok: false, status: 404, error: 'Message not found.' };
  const existing = await prisma.messagePin.findUnique({ where: { messageId }, select: { id: true } });
  if (existing) return { ok: true };
  await prisma.messagePin.create({ data: { conversationId, messageId, pinnedByPersonId: byPersonId } });
  return { ok: true };
}

/** Unpins a message (safe to repeat). */
export async function unpinMessage(conversationId: string, messageId: string): Promise<void> {
  await prisma.messagePin.deleteMany({ where: { conversationId, messageId } });
}

/** The viewer has opened this pin: the gold chip no longer shows for it. Safe to repeat. */
export async function markPinSeen(conversationId: string, messageId: string, personId: string): Promise<void> {
  const pin = await prisma.messagePin.findFirst({ where: { conversationId, messageId }, select: { id: true } });
  if (!pin) return;
  await prisma.messagePinSeen.upsert({ where: { pinId_personId: { pinId: pin.id, personId } }, create: { pinId: pin.id, personId }, update: {} });
}

/**
 * Pins several messages of this assembly at once (the ones of them that are really in this chat and
 * not deleted; already-pinned ones are left alone). Returns how many were newly pinned.
 */
export async function pinMessages(conversationId: string, messageIds: string[], byPersonId: string): Promise<number> {
  const ids = [...new Set(messageIds)].slice(0, MAX_PINS_PER_REQUEST);
  const valid = await prisma.message.findMany({ where: { id: { in: ids }, conversationId, deletedAt: null }, select: { id: true } });
  if (valid.length === 0) return 0;
  const done = await prisma.messagePin.createMany({
    data: valid.map((m) => ({ conversationId, messageId: m.id, pinnedByPersonId: byPersonId })),
    skipDuplicates: true,
  });
  return done.count;
}

/** Unpins several messages at once. Returns how many were unpinned. */
export async function unpinMessages(conversationId: string, messageIds: string[]): Promise<number> {
  const ids = [...new Set(messageIds)].slice(0, MAX_PINS_PER_REQUEST);
  return (await prisma.messagePin.deleteMany({ where: { conversationId, messageId: { in: ids } } })).count;
}

/** One pinned message in full (for reading it from the pin list), as this viewer sees it. Null when it is not pinned here. */
export async function pinFull(
  conversationId: string,
  messageId: string,
  viewerPersonId: string,
  viewerLanguage: 'en' | 'fr' | null,
): Promise<{ body: string | null; translation: { sourceLanguage: 'en' | 'fr'; translatedBody: string } | null } | null> {
  const pin = await prisma.messagePin.findFirst({
    where: { conversationId, messageId, message: { deletedAt: null, NOT: { hiddenFor: { some: { personId: viewerPersonId } } } } },
    select: { message: { select: { body: true, detectedLanguage: true, translatedBody: true } } },
  });
  if (!pin) return null;
  const m = pin.message;
  const translation = viewerLanguage && m.detectedLanguage && m.detectedLanguage !== viewerLanguage && m.translatedBody ? { sourceLanguage: m.detectedLanguage, translatedBody: m.translatedBody } : null;
  return { body: m.body, translation };
}
