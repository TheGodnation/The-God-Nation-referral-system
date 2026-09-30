import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../lib/asyncHandler';
import { requireCsrf } from '../lib/csrf';
import { messageSendLimiter, communityConversationReadLimiter } from '../lib/rateLimit';
import { parsePagination, paginatedResult } from '../lib/pagination';
import { notifyPrivateMessageReceived } from '../lib/notifications';
import {
  resolvePrivateMessagingActor,
  resolvePrivateConversationRole,
  getPrivateConversationUnreadCount,
  markPrivateConversationRead,
  type PrivateMessagingActor,
} from '../lib/privateMessaging';

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

type OtherParty = { otherPartyType: 'CENTRAL_AUTHORITY' } | { otherPartyType: 'LEADER' | 'MEMBER'; otherPartyName: string | null };

async function resolveOtherParty(
  role: 'MEMBER' | 'INITIATOR',
  conversation: { memberPersonId: string; initiatorUserId: string | null; initiatorPersonId: string | null },
): Promise<OtherParty> {
  if (role === 'MEMBER') {
    if (conversation.initiatorUserId) return { otherPartyType: 'CENTRAL_AUTHORITY' };
    const person = await prisma.person.findUnique({ where: { id: conversation.initiatorPersonId! }, select: { name: true } });
    return { otherPartyType: 'LEADER', otherPartyName: person?.name ?? null };
  }
  const person = await prisma.person.findUnique({ where: { id: conversation.memberPersonId }, select: { name: true } });
  return { otherPartyType: 'MEMBER', otherPartyName: person?.name ?? null };
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
      const [otherParty, unreadCount] = await Promise.all([
        resolveOtherParty(role, c),
        getPrivateConversationUnreadCount(actor, c),
      ]);
      return { id: c.id, createdAt: c.createdAt, ...otherParty, unreadCount };
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
      isOwn: actor.type === 'PERSON' ? m.senderPersonId === actor.personId : m.senderUserId === actor.userId,
      body: m.body,
      createdAt: m.createdAt,
    })),
    hasMore,
    unreadCount,
    ...otherParty,
  });
}));

const sendMessageSchema = z.object({ body: z.string().trim().min(1).max(2000) });

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

    const created = await prisma.privateMessage.create({
      data: {
        conversationId: conversation.id,
        body: parsed.data.body,
        ...(actor.type === 'PERSON' ? { senderPersonId: actor.personId } : { senderUserId: actor.userId }),
      },
    });

    await notifyPrivateMessageReceived(conversation, actor);

    res.status(201).json({ id: created.id, isOwn: true, body: created.body, createdAt: created.createdAt });
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

export default router;
