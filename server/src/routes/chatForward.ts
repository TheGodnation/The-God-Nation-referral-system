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
import { MAX_FORWARD_TARGETS } from '../lib/chatActions';

// POST /api/chat/forward — WhatsApp "Forward": send a copy of one message
// (its text and its photos / voice notes / files) to up to 5 chats you can
// write in. The copies are marked "↪ Forwarded". Every source and target is
// checked with the same rules as reading and sending normally; photos are
// copied inside storage to each chat's own place.

const chatRef = z.object({ kind: z.enum(['group', 'private']), chatId: z.string().min(1) });
const forwardSchema = z.object({
  source: chatRef.extend({ messageId: z.string().min(1) }),
  targets: z.array(chatRef).min(1).max(MAX_FORWARD_TARGETS),
});

type SourceMessage = {
  body: string | null;
  attachments: { storageKey: string; originalFilename: string; mimeType: string; byteSize: number; thumbDataUrl: string | null }[];
};

const attachmentSelect = { storageKey: true, originalFilename: true, mimeType: true, byteSize: true, thumbDataUrl: true } as const;

async function otherPersonOf(actor: PrivateMessagingActor, c: { memberPersonId: string; initiatorPersonId: string | null }) {
  if (actor.type !== 'PERSON') return null;
  return c.memberPersonId === actor.personId ? c.initiatorPersonId : c.memberPersonId;
}

async function loadSource(actor: PrivateMessagingActor, source: z.infer<typeof forwardSchema>['source']): Promise<SourceMessage | null> {
  if (source.kind === 'group') {
    if (actor.type !== 'PERSON') return null;
    if (!(await contextTargetExists('COMMUNITY', source.chatId))) return null;
    if (!(await hasConversationAccess(actor.personId, source.chatId))) return null;
    const conversation = await getOrCreateConversation(source.chatId);
    const m = await prisma.message.findUnique({
      where: { id: source.messageId },
      include: { attachments: { select: attachmentSelect }, hiddenFor: { where: { personId: actor.personId }, select: { id: true } } },
    });
    if (!m || m.conversationId !== conversation.id || m.deletedAt || m.hiddenFor.length > 0) return null;
    return { body: m.body, attachments: m.attachments };
  }
  const conversation = await prisma.privateConversation.findUnique({ where: { id: source.chatId } });
  if (!conversation || !resolvePrivateConversationRole(actor, conversation)) return null;
  const m = await prisma.privateMessage.findUnique({ where: { id: source.messageId }, include: { attachments: { select: attachmentSelect } } });
  if (!m || m.conversationId !== conversation.id || m.deletedAt) return null;
  return { body: m.body || null, attachments: m.attachments };
}

const router = Router();

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

    const message = await loadSource(actor, source);
    if (!message) return res.status(404).json({ error: 'Message not found.' });
    if (message.attachments.length > 0 && !isStorageConfigured()) {
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
            forwarded: true,
            attachments: copies.length
              ? {
                  create: copies.map((a) => ({
                    storageKey: a.newKey,
                    originalFilename: a.originalFilename,
                    mimeType: a.mimeType,
                    byteSize: a.byteSize,
                    thumbDataUrl: a.thumbDataUrl,
                    uploadedByPersonId: target.personId,
                  })),
                }
              : undefined,
          },
        });
        sent.push({ kind: 'group', chatId: target.communityId, messageId: created.id });
      } else {
        const created = await prisma.privateMessage.create({
          data: {
            conversationId: target.conversation.id,
            body: message.body ?? '',
            forwarded: true,
            ...(actor.type === 'PERSON' ? { senderPersonId: actor.personId } : { senderUserId: actor.userId }),
            attachments: copies.length
              ? {
                  create: copies.map((a) => ({
                    storageKey: a.newKey,
                    originalFilename: a.originalFilename,
                    mimeType: a.mimeType,
                    byteSize: a.byteSize,
                    thumbDataUrl: a.thumbDataUrl,
                  })),
                }
              : undefined,
          },
        });
        await notifyPrivateMessageReceived(target.conversation, actor);
        sent.push({ kind: 'private', chatId: target.conversation.id, messageId: created.id });
      }
    }

    res.status(201).json({ sent });
  }),
);

export default router;
