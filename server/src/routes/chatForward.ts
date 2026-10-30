import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../lib/asyncHandler';
import { requireCsrf } from '../lib/csrf';
import { chatForwardLimiter } from '../lib/rateLimit';
import { contextTargetExists } from '../lib/leadership';
import { hasConversationAccess, canPostCommunityMessage, getOrCreateConversation } from '../lib/communityConversation';
import { resolvePrivateMessagingActor, resolvePrivateConversationRole, type PrivateMessagingActor } from '../lib/privateMessaging';
import { isBlockedEitherWay } from '../lib/social';
import { generateStorageKey, generatePrivateAttachmentStorageKey } from '../lib/attachmentPolicy';
import { isStorageConfigured, copyObject } from '../lib/storage';
import { notifyPrivateMessageReceived } from '../lib/notifications';
import { MAX_FORWARD_MESSAGES, MAX_FORWARD_TARGETS } from '../lib/chatActions';
import { isCentralAdminPerson } from '../lib/centralAdmin';
import { translateAndStoreMessage, transcribeAndStoreMessageAudio } from '../lib/translation';

// POST /api/chat/forward — WhatsApp "Forward": send a copy of one message
// (its text and its photos / voice notes / files) to up to 5 chats you can
// write in. The copies are marked "↪ Forwarded". Every source and target is
// checked with the same rules as reading and sending normally; photos are
// copied inside storage to each chat's own place.
//
// Only the central admin can send a copy without the "Forwarded" label: always
// for their own messages, and on request for someone else's. Everyone else's
// copies always carry the label, so words are never passed off as the
// forwarder's own.

const chatRef = z.object({ kind: z.enum(['group', 'private']), chatId: z.string().min(1) });
const forwardSchema = z.object({
  // One message (messageId) or several selected together (messageIds, oldest first).
  source: chatRef
    .extend({ messageId: z.string().min(1).optional(), messageIds: z.array(z.string().min(1)).min(1).max(MAX_FORWARD_MESSAGES).optional() })
    .refine((s) => Boolean(s.messageId || s.messageIds), { message: 'Choose a message.' }),
  targets: z.array(chatRef).min(1).max(MAX_FORWARD_TARGETS),
  // Honoured for the central admin only; defaults to showing the label.
  markForwarded: z.boolean().optional(),
});

// What the app already worked out for a group message (its translation, or a
// voice note's transcript and translation). A copy sent to another group takes
// it along, so nothing is translated twice; only what is still missing is
// translated for the copy. Private chats are never translated at all.
type KnownTranslation = {
  detectedLanguage: 'en' | 'fr' | null;
  translatedBody: string | null;
  translatedAt: Date | null;
  transcribedLanguage: 'en' | 'fr' | null;
  transcribedBody: string | null;
  translatedTranscript: string | null;
  transcribedAt: Date | null;
};

type SourceMessage = {
  /** Whether the person forwarding wrote the message themselves. */
  isOwn: boolean;
  /** Set when the message comes from a group chat. */
  known?: KnownTranslation;
  body: string | null;
  attachments: { storageKey: string; originalFilename: string; mimeType: string; byteSize: number; thumbDataUrl: string | null; pageCount: number | null; language?: 'en' | 'fr' | null }[];
};

const attachmentSelect = { storageKey: true, originalFilename: true, mimeType: true, byteSize: true, thumbDataUrl: true, pageCount: true } as const;

async function otherPersonOf(actor: PrivateMessagingActor, c: { memberPersonId: string; initiatorPersonId: string | null }) {
  if (actor.type !== 'PERSON') return null;
  return c.memberPersonId === actor.personId ? c.initiatorPersonId : c.memberPersonId;
}

async function loadSource(actor: PrivateMessagingActor, source: { kind: 'group' | 'private'; chatId: string; messageId: string }): Promise<SourceMessage | null> {
  if (source.kind === 'group') {
    if (actor.type !== 'PERSON') return null;
    if (!(await contextTargetExists('COMMUNITY', source.chatId))) return null;
    if (!(await hasConversationAccess(actor.personId, source.chatId))) return null;
    const conversation = await getOrCreateConversation(source.chatId);
    const m = await prisma.message.findUnique({
      where: { id: source.messageId },
      include: { attachments: { select: { ...attachmentSelect, language: true } }, hiddenFor: { where: { personId: actor.personId }, select: { id: true } } },
    });
    if (!m || m.conversationId !== conversation.id || m.deletedAt || m.hiddenFor.length > 0) return null;
    const known: KnownTranslation = {
      detectedLanguage: m.detectedLanguage,
      translatedBody: m.translatedBody,
      translatedAt: m.translatedAt,
      transcribedLanguage: m.transcribedLanguage,
      transcribedBody: m.transcribedBody,
      translatedTranscript: m.translatedTranscript,
      transcribedAt: m.transcribedAt,
    };
    return { isOwn: m.senderPersonId === actor.personId, known, body: m.body, attachments: m.attachments };
  }
  const conversation = await prisma.privateConversation.findUnique({ where: { id: source.chatId } });
  if (!conversation || !resolvePrivateConversationRole(actor, conversation)) return null;
  const m = await prisma.privateMessage.findUnique({ where: { id: source.messageId }, include: { attachments: { select: attachmentSelect } } });
  if (!m || m.conversationId !== conversation.id || m.deletedAt) return null;
  const isOwn = actor.type === 'PERSON' ? m.senderPersonId === actor.personId : m.senderUserId === actor.userId;
  return { isOwn, body: m.body || null, attachments: m.attachments };
}

/** The admin's own account, or the member profile that belongs to it. */
async function isCentralAdminActor(actor: PrivateMessagingActor): Promise<boolean> {
  return actor.type === 'USER' ? true : isCentralAdminPerson(actor.personId);
}

const router = Router();

// Whether this person may send a forward without the "Forwarded" label (the
// forward screen shows its switch only to them).
router.get(
  '/forward/options',
  asyncHandler(async (req, res) => {
    const actor = await resolvePrivateMessagingActor(req);
    if (!actor) return res.status(401).json({ error: 'Authentication required.' });
    res.json({ canHideLabel: await isCentralAdminActor(actor) });
  }),
);

router.post(
  '/forward',
  chatForwardLimiter,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const actor = await resolvePrivateMessagingActor(req);
    if (!actor) return res.status(401).json({ error: 'Authentication required.' });

    const parsed = forwardSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: `Choose 1 to ${MAX_FORWARD_TARGETS} chats.` });
    const { source } = parsed.data;
    // The same chat chosen twice counts once.
    const targets = parsed.data.targets.filter(
      (t, i, all) => all.findIndex((o) => o.kind === t.kind && o.chatId === t.chatId) === i,
    );

    // Every selected message must be readable by this person; none is sent otherwise.
    const ids = [...new Set(source.messageIds ?? [source.messageId!])];
    const loaded: SourceMessage[] = [];
    for (const id of ids) {
      const m = await loadSource(actor, { kind: source.kind, chatId: source.chatId, messageId: id });
      if (!m) return res.status(404).json({ error: 'Message not found.' });
      loaded.push(m);
    }
    const isAdminActor = await isCentralAdminActor(actor);
    if (loaded.some((m) => m.attachments.length > 0) && !isStorageConfigured()) {
      return res.status(503).json({ error: 'Attachments are not available right now.' });
    }

    // Check every target first, so nothing is sent unless all are allowed.
    type Resolved =
      | { kind: 'group'; communityId: string; conversationId: string; personId: string }
      | { kind: 'private'; conversation: { id: string; memberPersonId: string; initiatorUserId: string | null; initiatorPersonId: string | null } };
    const resolved: Resolved[] = [];
    for (const t of targets) {
      if (t.kind === 'group') {
        if (actor.type !== 'PERSON' || !(await contextTargetExists('COMMUNITY', t.chatId)) || !(await canPostCommunityMessage(actor.personId, t.chatId))) {
          return res.status(403).json({ error: 'You cannot send messages to one of these chats.' });
        }
        const conversation = await getOrCreateConversation(t.chatId);
        resolved.push({ kind: 'group', communityId: t.chatId, conversationId: conversation.id, personId: actor.personId });
      } else {
        const conversation = await prisma.privateConversation.findUnique({ where: { id: t.chatId } });
        if (!conversation || !resolvePrivateConversationRole(actor, conversation)) {
          return res.status(403).json({ error: 'You cannot send messages to one of these chats.' });
        }
        const other = await otherPersonOf(actor, conversation);
        if (actor.type === 'PERSON' && other && (await isBlockedEitherWay(actor.personId, other))) {
          return res.status(403).json({ error: 'You cannot send messages to one of these chats.', code: 'BLOCKED' });
        }
        resolved.push({ kind: 'private', conversation });
      }
    }

    const sent: { kind: 'group' | 'private'; chatId: string; messageId: string }[] = [];
    for (const target of resolved) {
      // The selected messages go one after the other, in the order given.
      for (const message of loaded) {
        const forwarded = !(isAdminActor && (message.isOwn || parsed.data.markForwarded === false));
        const copies = [] as (SourceMessage['attachments'][number] & { newKey: string })[];
        for (const a of message.attachments) {
          const newKey = target.kind === 'group' ? generateStorageKey(target.communityId) : generatePrivateAttachmentStorageKey(target.conversation.id);
          await copyObject({ sourceKey: a.storageKey, destKey: newKey });
          copies.push({ ...a, newKey });
        }
        if (target.kind === 'group') {
          const created = await prisma.message.create({
            data: {
              conversationId: target.conversationId,
              senderPersonId: target.personId,
              body: message.body,
              forwarded,
              // The same words, so the translation already made is still right for the copy.
              ...(message.known?.translatedBody
                ? { detectedLanguage: message.known.detectedLanguage, translatedBody: message.known.translatedBody, translatedAt: message.known.translatedAt }
                : {}),
              ...(message.known?.transcribedBody && message.known.translatedTranscript
                ? {
                    transcribedLanguage: message.known.transcribedLanguage,
                    transcribedBody: message.known.transcribedBody,
                    translatedTranscript: message.known.translatedTranscript,
                    transcribedAt: message.known.transcribedAt,
                  }
                : {}),
              attachments: copies.length
                ? {
                    create: copies.map((a) => ({
                      storageKey: a.newKey,
                      originalFilename: a.originalFilename,
                      mimeType: a.mimeType,
                      byteSize: a.byteSize,
                      thumbDataUrl: a.thumbDataUrl,
                      language: a.language ?? null,
                      pageCount: a.pageCount,
                      uploadedByPersonId: target.personId,
                    })),
                  }
                : undefined,
            },
          });
          sent.push({ kind: 'group', chatId: target.communityId, messageId: created.id });
          // Whatever was not translated yet (a fresh message, one from a private chat, or one still being
          // translated) gets translated for the copy, in the background, like a message sent normally.
          if (created.body && !created.translatedBody) void translateAndStoreMessage(created.id, created.body).catch(() => {});
          const voice = copies.find((a) => a.mimeType.startsWith('audio/'));
          if (voice && !voice.language && !created.transcribedBody) void transcribeAndStoreMessageAudio(created.id, voice.newKey, voice.mimeType).catch(() => {});
        } else {
          const created = await prisma.privateMessage.create({
            data: {
              conversationId: target.conversation.id,
              body: message.body ?? '',
              forwarded,
              ...(actor.type === 'PERSON' ? { senderPersonId: actor.personId } : { senderUserId: actor.userId }),
              attachments: copies.length
                ? {
                    create: copies.map((a) => ({
                      storageKey: a.newKey,
                      originalFilename: a.originalFilename,
                      mimeType: a.mimeType,
                      byteSize: a.byteSize,
                      thumbDataUrl: a.thumbDataUrl,
                      pageCount: a.pageCount,
                    })),
                  }
                : undefined,
            },
          });
          await notifyPrivateMessageReceived(target.conversation, actor);
          sent.push({ kind: 'private', chatId: target.conversation.id, messageId: created.id });
        }
      }
    }

    res.status(201).json({ sent });
  }),
);

export default router;
