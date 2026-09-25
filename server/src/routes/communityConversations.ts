import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireCsrf } from '../lib/csrf';
import { messageSendLimiter, communityConversationReadLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import { resolveActingPersonId, contextTargetExists } from '../lib/leadership';
import {
  hasConversationAccess,
  getOrCreateConversation,
  markCommunityConversationRead,
  getCommunityConversationUnreadCount,
} from '../lib/communityConversation';

declare global {
  namespace Express {
    interface Request {
      // Phase 3M.1: the acting Member's or Leader's own linked Person id,
      // set only by requireConversationActor below — never derived from
      // client input. Admin never gets one (Admin has no routine
      // conversation access in this phase — see communityConversation.ts).
      conversationActorPersonId?: string;
    }
  }
}

const router = Router();

/**
 * Resolves the caller's own Person identity for conversation purposes —
 * either an authenticated Member (req.member, set by loadMemberSession) or
 * an authenticated Leader (req.user with role LEADER, resolved via the
 * existing User.personId link). An Admin's req.user is deliberately never
 * resolved here: Phase 3M.1 has no Admin conversation-browsing route.
 */
async function resolveConversationActorPersonId(req: Request): Promise<string | null> {
  if (req.member) return req.member.personId;
  if (req.user?.role === 'LEADER') return resolveActingPersonId(req.user.id);
  return null;
}

async function requireConversationActor(req: Request, res: Response, next: NextFunction) {
  const personId = await resolveConversationActorPersonId(req);
  if (!personId) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  req.conversationActorPersonId = personId;
  next();
}

router.use(requireConversationActor);

// GET /api/communities/:communityId/conversation — conversation metadata
// only (no messages). 404 for a Community that doesn't exist at all; 403
// for a real Community the caller has no current relationship to — mirrors
// the existing contextTargetExists / findActiveScopedRole two-step check
// already used by leaderFollowUps.ts.
router.get('/:communityId/conversation', asyncHandler(async (req, res) => {
  const { communityId } = req.params;

  if (!(await contextTargetExists('COMMUNITY', communityId))) {
    return res.status(404).json({ error: 'Community not found.' });
  }

  const personId = req.conversationActorPersonId!;
  if (!(await hasConversationAccess(personId, communityId))) {
    return res.status(403).json({ error: 'You do not have access to this community\'s conversation.' });
  }

  const conversation = await getOrCreateConversation(communityId);
  const unreadCount = await getCommunityConversationUnreadCount(personId, conversation.id);
  res.json({ id: conversation.id, communityId: conversation.communityId, createdAt: conversation.createdAt, unreadCount });
}));

const DEFAULT_MESSAGE_PAGE_SIZE = 30;
const MAX_MESSAGE_PAGE_SIZE = 50;

const listMessagesQuerySchema = z.object({
  before: z.string().optional(),
  // A requested limit above the maximum is capped, not rejected — a client
  // asking for "too much" is not a malformed request.
  limit: z.coerce.number().int().min(1).optional(),
});

// GET /api/communities/:communityId/conversation/messages — cursor-paginated,
// newest-first internally, returned oldest-first for direct rendering.
// `before` must be a message id that actually belongs to THIS conversation
// — never trusted as a bound on any other conversation's messages.
router.get('/:communityId/conversation/messages', asyncHandler(async (req, res) => {
  const { communityId } = req.params;

  if (!(await contextTargetExists('COMMUNITY', communityId))) {
    return res.status(404).json({ error: 'Community not found.' });
  }

  const personId = req.conversationActorPersonId!;
  if (!(await hasConversationAccess(personId, communityId))) {
    return res.status(403).json({ error: 'You do not have access to this community\'s conversation.' });
  }

  const parsed = listMessagesQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid pagination parameters.' });
  }
  const limit = Math.min(parsed.data.limit ?? DEFAULT_MESSAGE_PAGE_SIZE, MAX_MESSAGE_PAGE_SIZE);

  const conversation = await getOrCreateConversation(communityId);

  let cursor: { createdAt: Date; id: string } | null = null;
  if (parsed.data.before) {
    const cursorMessage = await prisma.message.findUnique({ where: { id: parsed.data.before } });
    if (!cursorMessage || cursorMessage.conversationId !== conversation.id) {
      return res.status(400).json({ error: 'Invalid pagination cursor.' });
    }
    cursor = { createdAt: cursorMessage.createdAt, id: cursorMessage.id };
  }

  const rows = await prisma.message.findMany({
    where: {
      conversationId: conversation.id,
      ...(cursor
        ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] }
        : {}),
    },
    include: { sender: { select: { name: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).reverse();
  const unreadCount = await getCommunityConversationUnreadCount(personId, conversation.id);

  res.json({
    items: page.map((m) => ({ id: m.id, senderName: m.sender.name, body: m.body, createdAt: m.createdAt })),
    hasMore,
    unreadCount,
  });
}));

const sendMessageSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});

// POST /api/communities/:communityId/conversation/messages — senderPersonId
// is always req.conversationActorPersonId, never accepted from the body.
router.post(
  '/:communityId/conversation/messages',
  messageSendLimiter,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const { communityId } = req.params;

    if (!(await contextTargetExists('COMMUNITY', communityId))) {
      return res.status(404).json({ error: 'Community not found.' });
    }

    const personId = req.conversationActorPersonId!;
    if (!(await hasConversationAccess(personId, communityId))) {
      return res.status(403).json({ error: 'You do not have access to this community\'s conversation.' });
    }

    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid message.' });
    }

    const conversation = await getOrCreateConversation(communityId);

    const created = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderPersonId: personId,
        body: parsed.data.body,
      },
    });

    res.status(201).json({ id: created.id, body: created.body, createdAt: created.createdAt });
  }),
);

const markReadSchema = z.object({
  messageId: z.string().min(1),
});

// POST /api/communities/:communityId/conversation/read — advances the
// caller's own read cursor to the given message's createdAt. `messageId` is
// validated to belong to THIS conversation (same pattern as the `before`
// pagination cursor above) — never a raw client-supplied timestamp, and
// never another Person's id. Idempotent; never moves the cursor backwards
// (see markCommunityConversationRead). Read state never grants access: the
// same contextTargetExists / hasConversationAccess checks run first, exactly
// as every other route in this file.
router.post(
  '/:communityId/conversation/read',
  communityConversationReadLimiter,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const { communityId } = req.params;

    if (!(await contextTargetExists('COMMUNITY', communityId))) {
      return res.status(404).json({ error: 'Community not found.' });
    }

    const personId = req.conversationActorPersonId!;
    if (!(await hasConversationAccess(personId, communityId))) {
      return res.status(403).json({ error: 'You do not have access to this community\'s conversation.' });
    }

    const parsed = markReadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'A messageId is required.' });
    }

    const conversation = await getOrCreateConversation(communityId);

    const message = await prisma.message.findUnique({ where: { id: parsed.data.messageId } });
    if (!message || message.conversationId !== conversation.id) {
      return res.status(400).json({ error: 'Invalid message reference.' });
    }

    await markCommunityConversationRead(personId, conversation.id, message.createdAt);
    const unreadCount = await getCommunityConversationUnreadCount(personId, conversation.id);

    res.json({ unreadCount });
  }),
);

export default router;
