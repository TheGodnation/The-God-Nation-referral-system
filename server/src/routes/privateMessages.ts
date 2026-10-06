import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../lib/asyncHandler';
import { requireCsrf } from '../lib/csrf';
import {
  messageSendLimiter,
  communityConversationReadLimiter,
  attachmentUploadAuthorizeLimiter,
  attachmentDownloadLimiter,
  messageReactionLimiter,
} from '../lib/rateLimit';
import { isStorageConfigured, createUploadUrl, createDownloadUrl, headObject } from '../lib/storage';
import {
  isAllowedAttachmentMime,
  maxBytesForMime,
  isValidOriginalFilename,
  generatePrivateAttachmentStorageKey,
  isStorageKeyForPrivateConversation,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ORIGINAL_FILENAME_LENGTH,
} from '../lib/attachmentPolicy';
import { profilePhotoPath } from '../lib/profilePhoto';
import { parsePagination, paginatedResult } from '../lib/pagination';
import { notifyPrivateMessageReceived } from '../lib/notifications';
import {
  resolvePrivateMessagingActor,
  resolvePrivateConversationRole,
  getPrivateConversationUnreadCount,
  markPrivateConversationRead,
  type PrivateMessagingActor,
} from '../lib/privateMessaging';
import { isBlockedEitherWay } from '../lib/social';

declare global {
  namespace Express {
    interface Request {
      // The acting Person or User for Private Messaging purposes, set only
      // by requirePrivateMessagingActor below — never derived from client
      // input. Unlike every other conversation surface in this codebase,
      // Admin IS resolved here (as a User, never a Person) — see
      // lib/privateMessaging.ts's own comment on why this feature alone
      // needs Admin to be a genuine two-way participant.
      privateMessagingActor?: PrivateMessagingActor;
    }
  }
}

async function requirePrivateMessagingActor(req: Request, res: Response, next: NextFunction) {
  const actor = await resolvePrivateMessagingActor(req);
  if (!actor) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  req.privateMessagingActor = actor;
  next();
}

const router = Router();

router.use(requirePrivateMessagingActor);

type OtherParty =
  | { otherPartyType: 'CENTRAL_AUTHORITY' }
  | {
      otherPartyType: 'LEADER' | 'MEMBER';
      otherPartyName: string | null;
      otherPartyPersonId: string;
      otherPartyPhotoUrl: string | null;
    };

const photoSelect = { id: true, name: true, photoStorageKey: true, photoUpdatedAt: true } as const;

// WhatsApp-style quick reactions (same list as group chat).
const ALLOWED_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

type ReactionRow = { emoji: string; personId: string | null; userId: string | null };

function isActorRow(actor: PrivateMessagingActor, row: { personId: string | null; userId: string | null }) {
  return actor.type === 'PERSON' ? row.personId === actor.personId : row.userId === actor.userId;
}

function summarizeReactions(rows: ReactionRow[], actor: PrivateMessagingActor) {
  return ALLOWED_REACTIONS.filter((e) => rows.some((r) => r.emoji === e)).map((emoji) => {
    const mine = rows.filter((r) => r.emoji === emoji);
    return { emoji, count: mine.length, mine: mine.some((r) => isActorRow(actor, r)) };
  });
}

function isOwnMessage(actor: PrivateMessagingActor, m: { senderPersonId: string | null; senderUserId: string | null }) {
  return actor.type === 'PERSON' ? m.senderPersonId === actor.personId : m.senderUserId === actor.userId;
}

async function resolveOtherParty(
  role: 'MEMBER' | 'INITIATOR',
  conversation: { memberPersonId: string; initiatorUserId: string | null; initiatorPersonId: string | null },
): Promise<OtherParty> {
  if (role === 'MEMBER') {
    if (conversation.initiatorUserId) return { otherPartyType: 'CENTRAL_AUTHORITY' };
    const initiatorId = conversation.initiatorPersonId!;
    const [person, roleCount] = await Promise.all([
      prisma.person.findUnique({ where: { id: initiatorId }, select: photoSelect }),
      prisma.roleAssignment.count({ where: { personId: initiatorId, status: 'ACTIVE' } }),
    ]);
    // A conversation started by another member (friends / same group) is
    // shown as with a member; one started by a leader as with a leader.
    return {
      otherPartyType: roleCount > 0 ? 'LEADER' : 'MEMBER',
      otherPartyName: person?.name ?? null,
      otherPartyPersonId: initiatorId,
      otherPartyPhotoUrl: person ? profilePhotoPath(person) : null,
    };
  }
  const person = await prisma.person.findUnique({ where: { id: conversation.memberPersonId }, select: photoSelect });
  return {
    otherPartyType: 'MEMBER',
    otherPartyName: person?.name ?? null,
    otherPartyPersonId: conversation.memberPersonId,
    otherPartyPhotoUrl: person ? profilePhotoPath(person) : null,
  };
}

// GET /api/private-messages/conversations — every PrivateConversation the
// caller currently participates in (either side), newest-created-first,
// page-based pagination. Never returns another Person's/User's
// conversations — the WHERE clause is always keyed off the server-resolved
// actor identity, never a client-supplied filter.
router.get('/conversations', asyncHandler(async (req, res) => {
  const actor = req.privateMessagingActor!;
  const { page, pageSize, skip, take } = parsePagination(req);

  const where =
    actor.type === 'PERSON'
      ? { OR: [{ memberPersonId: actor.personId }, { initiatorPersonId: actor.personId }] }
      : { initiatorUserId: actor.userId };

  const [total, conversations] = await Promise.all([
    prisma.privateConversation.count({ where }),
    prisma.privateConversation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
  ]);

  const items = await Promise.all(
    conversations.map(async (c) => {
      const role = resolvePrivateConversationRole(actor, c)!;
      const [otherParty, unreadCount, last] = await Promise.all([
        resolveOtherParty(role, c),
        getPrivateConversationUnreadCount(actor, c),
        prisma.privateMessage.findFirst({
          where: { conversationId: c.id },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          include: { attachments: { select: { mimeType: true }, take: 1 } },
        }),
      ]);
      // The newest message, for the WhatsApp-style chat list preview.
      const lastMessage = last
        ? {
            body: last.body,
            attachmentMimeType: last.attachments[0]?.mimeType ?? null,
            isOwn: isOwnMessage(actor, last),
            createdAt: last.createdAt,
          }
        : null;
      return { id: c.id, createdAt: c.createdAt, ...otherParty, unreadCount, lastMessage };
    }),
  );

  res.json(paginatedResult(items, total, page, pageSize));
}));

const DEFAULT_MESSAGE_PAGE_SIZE = 30;
const MAX_MESSAGE_PAGE_SIZE = 50;

const listMessagesQuerySchema = z.object({
  before: z.string().optional(),
  limit: z.coerce.number().int().min(1).optional(),
});

async function loadAuthorizedConversation(req: Request, res: Response) {
  const { id } = req.params;
  const actor = req.privateMessagingActor!;
  const conversation = await prisma.privateConversation.findUnique({ where: { id } });
  if (!conversation) {
    res.status(404).json({ error: 'Conversation not found.' });
    return null;
  }
  const role = resolvePrivateConversationRole(actor, conversation);
  if (!role) {
    // 404, never 403 — a non-participant can never distinguish a real
    // conversation they don't belong to from one that doesn't exist.
    res.status(404).json({ error: 'Conversation not found.' });
    return null;
  }
  return { conversation, role };
}

// GET /api/private-messages/conversations/:id/messages — cursor-paginated,
// newest-first internally, returned oldest-first for direct rendering —
// identical convention to communityConversations.ts / headquartersPosts.ts.
// `before` must be a message id that actually belongs to THIS conversation.
router.get('/conversations/:id/messages', asyncHandler(async (req, res) => {
  const loaded = await loadAuthorizedConversation(req, res);
  if (!loaded) return;
  const { conversation, role } = loaded;
  const actor = req.privateMessagingActor!;

  const parsed = listMessagesQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid pagination parameters.' });
  }
  const limit = Math.min(parsed.data.limit ?? DEFAULT_MESSAGE_PAGE_SIZE, MAX_MESSAGE_PAGE_SIZE);

  let cursor: { createdAt: Date; id: string } | null = null;
  if (parsed.data.before) {
    const cursorMessage = await prisma.privateMessage.findUnique({ where: { id: parsed.data.before } });
    if (!cursorMessage || cursorMessage.conversationId !== conversation.id) {
      return res.status(400).json({ error: 'Invalid pagination cursor.' });
    }
    cursor = { createdAt: cursorMessage.createdAt, id: cursorMessage.id };
  }

  const rows = await prisma.privateMessage.findMany({
    where: {
      conversationId: conversation.id,
      ...(cursor
        ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    include: {
      attachments: { select: { id: true, originalFilename: true, mimeType: true, byteSize: true } },
      replyTo: {
        select: { id: true, body: true, senderPersonId: true, senderUserId: true, attachments: { select: { mimeType: true }, take: 1 } },
      },
      reactions: { select: { emoji: true, personId: true, userId: true } },
    },
  });

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).reverse();
  const [otherParty, unreadCount] = await Promise.all([
    resolveOtherParty(role, conversation),
    getPrivateConversationUnreadCount(actor, conversation),
  ]);

  res.json({
    items: page.map((m) => ({
      id: m.id,
      // Deliberately no per-message sender name/label: a private
      // conversation only ever has 2 sides, and the client already knows
      // the "other party" label from this same response — isOwn alone is
      // sufficient (unlike Community/Headquarters messages, which can have
      // many distinct senders and so need a per-message name).
      isOwn: isOwnMessage(actor, m),
      body: m.body,
      createdAt: m.createdAt,
      attachments: m.attachments,
      replyTo: m.replyTo
        ? {
            id: m.replyTo.id,
            isOwn: isOwnMessage(actor, m.replyTo),
            body: m.replyTo.body,
            attachmentMimeType: m.replyTo.attachments[0]?.mimeType ?? null,
          }
        : null,
      reactions: summarizeReactions(m.reactions, actor),
    })),
    hasMore,
    unreadCount,
    ...otherParty,
  });
}));

const attachmentDescriptorSchema = z.object({
  storageKey: z.string().min(1),
  originalFilename: z.string().trim().min(1).max(MAX_ORIGINAL_FILENAME_LENGTH),
  mimeType: z.string().min(1),
  byteSize: z.number().int().positive(),
});

// Text, attachments (photos, voice notes, videos, PDFs), or both — never
// completely empty. A reply points at a message in the same conversation.
const sendMessageSchema = z
  .object({
    body: z.string().trim().max(2000).optional(),
    attachments: z.array(attachmentDescriptorSchema).max(MAX_ATTACHMENTS_PER_MESSAGE).optional(),
    replyToMessageId: z.string().min(1).optional(),
  })
  .refine((d) => Boolean(d.body && d.body.length > 0) || Boolean(d.attachments && d.attachments.length > 0), {
    message: 'Write a message or add a file.',
  });

// POST /api/private-messages/conversations/:id/messages — sender identity
// is always the authenticated actor's own resolved identity, never accepted
// from the request body. Never permits arbitrary users to add themselves or
// anyone else as a participant — this route only ever creates a
// PrivateMessage row on an ALREADY-authorized conversation.
router.post(
  '/conversations/:id/messages',
  messageSendLimiter,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const loaded = await loadAuthorizedConversation(req, res);
    if (!loaded) return;
    const { conversation } = loaded;
    const actor = req.privateMessagingActor!;

    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid message.' });
    }

    // Between two people, a block (either way) stops replies too.
    if (actor.type === 'PERSON') {
      const otherPersonId =
        conversation.memberPersonId === actor.personId ? conversation.initiatorPersonId : conversation.memberPersonId;
      if (otherPersonId && (await isBlockedEitherWay(actor.personId, otherPersonId))) {
        return res.status(403).json({ error: 'You cannot message this person.', code: 'BLOCKED' });
      }
    }

    const attachments = parsed.data.attachments ?? [];
    for (const a of attachments) {
      if (!isStorageKeyForPrivateConversation(a.storageKey, conversation.id)) {
        return res.status(400).json({ error: 'Invalid attachment reference.' });
      }
      if (!isAllowedAttachmentMime(a.mimeType)) return res.status(400).json({ error: 'Unsupported attachment type.' });
      if (a.byteSize > maxBytesForMime(a.mimeType)!) return res.status(400).json({ error: 'Attachment is too large.' });
      if (!isValidOriginalFilename(a.originalFilename)) return res.status(400).json({ error: 'Invalid attachment filename.' });
    }
    if (new Set(attachments.map((a) => a.storageKey)).size !== attachments.length) {
      return res.status(400).json({ error: 'Duplicate attachment reference.' });
    }
    if (attachments.length > 0) {
      if (!isStorageConfigured()) return res.status(503).json({ error: 'Attachments are not available right now.' });
      // The upload must really have landed, with the declared type and size.
      for (const a of attachments) {
        const head = await headObject({ storageKey: a.storageKey });
        if (!head || head.contentLength !== a.byteSize || (head.contentType && head.contentType !== a.mimeType)) {
          return res.status(400).json({ error: 'Attachment upload could not be verified.' });
        }
      }
    }

    const replyToMessageId = parsed.data.replyToMessageId ?? null;
    if (replyToMessageId) {
      const original = await prisma.privateMessage.findUnique({ where: { id: replyToMessageId }, select: { conversationId: true } });
      if (!original || original.conversationId !== conversation.id) {
        return res.status(400).json({ error: 'Invalid reply reference.' });
      }
    }

    const created = await prisma.privateMessage.create({
      data: {
        conversationId: conversation.id,
        body: parsed.data.body ?? '',
        replyToMessageId,
        ...(actor.type === 'PERSON' ? { senderPersonId: actor.personId } : { senderUserId: actor.userId }),
        attachments: attachments.length
          ? {
              create: attachments.map((a) => ({
                storageKey: a.storageKey,
                originalFilename: a.originalFilename,
                mimeType: a.mimeType,
                byteSize: a.byteSize,
              })),
            }
          : undefined,
      },
      include: { attachments: { select: { id: true, originalFilename: true, mimeType: true, byteSize: true } } },
    });

    await notifyPrivateMessageReceived(conversation, actor);

    res.status(201).json({
      id: created.id,
      isOwn: true,
      body: created.body,
      createdAt: created.createdAt,
      attachments: created.attachments,
      replyToMessageId: created.replyToMessageId,
    });
  }),
);

const markReadSchema = z.object({ messageId: z.string().min(1) });

// POST /api/private-messages/conversations/:id/read — advances the
// caller's own read cursor only. `messageId` is validated to belong to THIS
// conversation, never a raw client-supplied timestamp. One participant can
// never alter another's read state — markPrivateConversationRead always
// operates on the server-resolved actor identity.
router.post(
  '/conversations/:id/read',
  communityConversationReadLimiter,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const loaded = await loadAuthorizedConversation(req, res);
    if (!loaded) return;
    const { conversation } = loaded;
    const actor = req.privateMessagingActor!;

    const parsed = markReadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'A messageId is required.' });
    }

    const message = await prisma.privateMessage.findUnique({ where: { id: parsed.data.messageId } });
    if (!message || message.conversationId !== conversation.id) {
      return res.status(400).json({ error: 'Invalid message reference.' });
    }

    await markPrivateConversationRead(actor, conversation.id, message.createdAt);
    const unreadCount = await getPrivateConversationUnreadCount(actor, conversation);

    res.json({ unreadCount });
  }),
);

// POST /api/private-messages/conversations/:id/attachments/authorize — a
// short-lived upload link for a photo / voice note / video / PDF, with a
// server-made storage key tied to THIS conversation. Nothing is saved until
// the message itself is sent (and the upload checked).
const authorizeAttachmentSchema = z.object({
  originalFilename: z.string().trim().min(1).max(MAX_ORIGINAL_FILENAME_LENGTH),
  mimeType: z.string().min(1),
  byteSize: z.number().int().positive(),
});

router.post(
  '/conversations/:id/attachments/authorize',
  attachmentUploadAuthorizeLimiter,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const loaded = await loadAuthorizedConversation(req, res);
    if (!loaded) return;
    const parsed = authorizeAttachmentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid attachment request.' });
    const { originalFilename, mimeType, byteSize } = parsed.data;
    if (!isAllowedAttachmentMime(mimeType)) return res.status(400).json({ error: 'Unsupported attachment type.' });
    const maxBytes = maxBytesForMime(mimeType)!;
    if (byteSize > maxBytes) return res.status(400).json({ error: 'Attachment is too large.' });
    if (!isValidOriginalFilename(originalFilename)) return res.status(400).json({ error: 'Invalid attachment filename.' });
    if (!isStorageConfigured()) return res.status(503).json({ error: 'Attachments are not available right now.' });

    const storageKey = generatePrivateAttachmentStorageKey(loaded.conversation.id);
    const { url, expiresAt } = await createUploadUrl({ storageKey, mimeType });
    res.json({ storageKey, uploadUrl: url, expiresAt, maxBytes });
  }),
);

// GET .../conversations/:id/messages/:messageId/attachments/:attachmentId/download-url
router.get(
  '/conversations/:id/messages/:messageId/attachments/:attachmentId/download-url',
  attachmentDownloadLimiter,
  asyncHandler(async (req, res) => {
    const loaded = await loadAuthorizedConversation(req, res);
    if (!loaded) return;
    const attachment = await prisma.privateMessageAttachment.findUnique({
      where: { id: req.params.attachmentId },
      include: { message: { select: { id: true, conversationId: true } } },
    });
    if (!attachment || attachment.message.id !== req.params.messageId || attachment.message.conversationId !== loaded.conversation.id) {
      return res.status(404).json({ error: 'Attachment not found.' });
    }
    if (!isStorageConfigured()) return res.status(503).json({ error: 'Attachments are not available right now.' });
    const { url, expiresAt } = await createDownloadUrl({ storageKey: attachment.storageKey });
    res.json({ url, expiresAt });
  }),
);

// PUT / DELETE .../conversations/:id/messages/:messageId/reaction — the
// caller's own reaction (one per person; choosing again changes it).
const reactionSchema = z.object({ emoji: z.enum(ALLOWED_REACTIONS) });

async function loadMessageInConversation(req: Request, res: Response) {
  const loaded = await loadAuthorizedConversation(req, res);
  if (!loaded) return null;
  const message = await prisma.privateMessage.findUnique({ where: { id: req.params.messageId }, select: { id: true, conversationId: true } });
  if (!message || message.conversationId !== loaded.conversation.id) {
    res.status(404).json({ error: 'Message not found.' });
    return null;
  }
  return message;
}

async function reactionsFor(messageId: string, actor: PrivateMessagingActor) {
  const rows = await prisma.privateMessageReaction.findMany({ where: { messageId }, select: { emoji: true, personId: true, userId: true } });
  return summarizeReactions(rows, actor);
}

router.put(
  '/conversations/:id/messages/:messageId/reaction',
  messageReactionLimiter,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const message = await loadMessageInConversation(req, res);
    if (!message) return;
    const parsed = reactionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Unsupported reaction.' });
    const actor = req.privateMessagingActor!;
    const who = actor.type === 'PERSON' ? { personId: actor.personId } : { userId: actor.userId };
    const existing = await prisma.privateMessageReaction.findFirst({ where: { messageId: message.id, ...who } });
    if (existing) {
      await prisma.privateMessageReaction.update({ where: { id: existing.id }, data: { emoji: parsed.data.emoji } });
    } else {
      await prisma.privateMessageReaction.create({ data: { messageId: message.id, emoji: parsed.data.emoji, ...who } });
    }
    res.json({ reactions: await reactionsFor(message.id, actor) });
  }),
);

router.delete(
  '/conversations/:id/messages/:messageId/reaction',
  messageReactionLimiter,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const message = await loadMessageInConversation(req, res);
    if (!message) return;
    const actor = req.privateMessagingActor!;
    const who = actor.type === 'PERSON' ? { personId: actor.personId } : { userId: actor.userId };
    await prisma.privateMessageReaction.deleteMany({ where: { messageId: message.id, ...who } });
    res.json({ reactions: await reactionsFor(message.id, actor) });
  }),
);

export default router;
