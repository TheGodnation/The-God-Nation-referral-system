import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireCsrf } from '../lib/csrf';
import { messageSendLimiter, communityConversationReadLimiter, communityModerationLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import { resolveActingPersonId, contextTargetExists, isCommunityAdministrator } from '../lib/leadership';
import { recordAudit } from '../lib/audit';
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
  const isAdministrator = await isCommunityAdministrator(personId, communityId);
  res.json({
    id: conversation.id,
    communityId: conversation.communityId,
    createdAt: conversation.createdAt,
    unreadCount,
    isAdministrator,
  });
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
  const isAdministrator = await isCommunityAdministrator(personId, communityId);

  res.json({
    // Phase 3M.8A: a moderated message's original body is never sent to
    // ordinary participants — only `deleted: true`. The row itself (and its
    // real body) is preserved server-side for future Central Authority
    // investigative access (Phase 3M.8B), never exposed here.
    items: page.map((m) => ({
      id: m.id,
      senderName: m.sender.name,
      body: m.deletedAt ? null : m.body,
      createdAt: m.createdAt,
      deleted: Boolean(m.deletedAt),
    })),
    hasMore,
    unreadCount,
    isAdministrator,
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

// DELETE /api/communities/:communityId/conversation/messages/:messageId —
// Phase 3M.8A moderation. Only an active Community Administrator for this
// EXACT Community (isCommunityAdministrator — an ACTIVE SCOPED_LEADER
// RoleAssignment for communityId itself, never a parent/child/geography
// scope) may remove a message. This is reachable through the same shared
// requireConversationActor middleware as every other route in this file
// (Member or Leader session), because authority here belongs to the acting
// Person, not to which session they happen to be using — the same
// shared-identity precedent already established by Phase 3M.7's read state.
// An ordinary Member or a Leader without this exact role is rejected by
// isCommunityAdministrator itself, never by the session type.
//
// Soft delete only: deletedAt/deletedByPersonId are set, the row and its
// original body are never removed — see the Message model's own schema
// comment. Idempotent: deleting an already-deleted message is a safe no-op,
// not an error.
router.delete(
  '/:communityId/conversation/messages/:messageId',
  communityModerationLimiter,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const { communityId, messageId } = req.params;

    if (!(await contextTargetExists('COMMUNITY', communityId))) {
      return res.status(404).json({ error: 'Community not found.' });
    }

    const personId = req.conversationActorPersonId!;
    if (!(await isCommunityAdministrator(personId, communityId))) {
      return res.status(403).json({ error: 'Only an active Community Administrator may remove a message.' });
    }

    const conversation = await getOrCreateConversation(communityId);

    // Validated to belong to THIS exact conversation — the same
    // never-trust-a-bare-id pattern already used for the pagination cursor
    // and the read-state messageId above, so a message id from a different
    // Community's conversation can never be moderated via this route.
    const message = await prisma.message.findUnique({ where: { id: messageId } });
    if (!message || message.conversationId !== conversation.id) {
      return res.status(404).json({ error: 'Message not found.' });
    }

    if (!message.deletedAt) {
      await prisma.message.update({
        where: { id: messageId },
        data: { deletedAt: new Date(), deletedByPersonId: personId },
      });

      await recordAudit({
        actorId: req.user?.id ?? null,
        actorEmail: req.user?.email ?? null,
        action: 'COMMUNITY_MESSAGE_DELETED',
        targetType: 'Message',
        targetId: messageId,
        metadata: { communityId, conversationId: conversation.id, deletedByPersonId: personId },
      });
    }

    res.json({ id: messageId, deleted: true });
  }),
);

export default router;
