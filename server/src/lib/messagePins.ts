import { prisma } from './prisma';
import { badgeOf, centralAdminAmong } from './centralAdmin';

// ---------------------------------------------------------------------------
// Pinned messages. The central admin can pin up to three messages at the top
// of an assembly's chat. Everyone in the assembly sees them first, however
// many messages come after, and a newcomer sees them whatever their age (they
// are shown from this list, not from the chat's history window). A pin the
// viewer has not looked at yet is "unseen": the app shows the gold "Important
// message, tap to read" chip for it until they open it.
// ---------------------------------------------------------------------------

export const MAX_PINS = 3;
const PREVIEW_CHARS = 2000;

export interface PinView {
  messageId: string;
  senderName: string;
  senderPersonId: string;
  senderBadge: 'NATIONAL_COORDINATOR' | null;
  body: string | null;
  translation: { sourceLanguage: 'en' | 'fr'; translatedBody: string } | null;
  teachingTitle: string | null;
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
          teaching: { select: { title: true, titleTranslated: true, detectedLanguage: true } },
        },
      },
      seen: { where: { personId: viewerPersonId }, select: { id: true } },
    },
  });
  const coordinators = await centralAdminAmong(pins.map((p) => p.message.senderPersonId));
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
      translation: translated,
      teachingTitle,
      attachmentMimeType: m.attachments[0]?.mimeType ?? null,
      createdAt: m.createdAt,
      pinnedAt: p.pinnedAt,
      // Nobody is nudged about a message they pinned themselves.
      unseen: p.pinnedByPersonId !== viewerPersonId && p.seen.length === 0,
    };
  });
}

export type PinResult = { ok: true } | { ok: false; status: 404 | 409; error: string };

/** Pins a message of this assembly (safe to repeat). At most MAX_PINS at a time. */
export async function pinMessage(conversationId: string, messageId: string, byPersonId: string): Promise<PinResult> {
  const message = await prisma.message.findUnique({ where: { id: messageId }, select: { conversationId: true, deletedAt: true } });
  if (!message || message.conversationId !== conversationId || message.deletedAt) return { ok: false, status: 404, error: 'Message not found.' };
  const existing = await prisma.messagePin.findUnique({ where: { messageId }, select: { id: true } });
  if (existing) return { ok: true };
  const count = await prisma.messagePin.count({ where: { conversationId, message: { deletedAt: null } } });
  if (count >= MAX_PINS) return { ok: false, status: 409, error: `You can pin up to ${MAX_PINS} messages. Unpin one first.` };
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
