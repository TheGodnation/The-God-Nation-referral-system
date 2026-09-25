import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireCsrf } from '../lib/csrf';
import { followUpMessageSendLimiter, followUpConversationReadLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import { resolveActingPersonId } from '../lib/leadership';
import {
  resolveFollowUpConversationRole,
  getOrCreateFollowUpConversation,
  markFollowUpConversationRead,
  getFollowUpConversationUnreadCount,
} from '../lib/followUpConversation';

declare global {
  namespace Express {
    interface Request {
      // Phase 3M.2: the acting Member's or Leader's own linked Person id,
      // set only by requireFollowUpConversationActor below — never derived
      // from client input. Admin never gets one: there is no Admin
      // conversation-browsing route in this phase. Deliberately a distinct
      // property from Phase 3M.1's conversationActorPersonId — this route
      // family stays fully independent of communityConversations.ts.
      followUpConversationActorPersonId?: string;
    }
  }
}

const router = Router();

/**
 * Resolves the caller's own Person identity — either an authenticated
 * Member (req.member, set by loadMemberSession) or an authenticated Leader
 * (req.user with role LEADER, resolved via the existing User.personId
 * link). An Admin's req.user is deliberately never resolved here: Admin has
 * no routine Follow-Up conversation access in this phase, and is never
 * granted participation merely because it can technically inspect the
 * database. If the followed Person has no MemberAccount, req.member can
 * never be set for them — the absence of a MemberAccount therefore can
 * never be bypassed, it simply means this middleware falls through to 401.
 */
async function resolveFollowUpConversationActorPersonId(req: Request): Promise<string | null> {
  if (req.member) return req.member.personId;
  if (req.user?.role === 'LEADER') return resolveActingPersonId(req.user.id);
  return null;
}

async function requireFollowUpConversationActor(req: Request, res: Response, next: NextFunction) {
  const personId = await resolveFollowUpConversationActorPersonId(req);
  if (!personId) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  req.followUpConversationActorPersonId = personId;
  next();
}

router.use(requireFollowUpConversationActor);

/**
 * Loads the FollowUpAssignment and confirms personId is one of its two
 * participants (follower or followed person) — the FollowUpAssignment
 * relationship itself is the sole authority, never geography, Community,
 * roster visibility, or any other signal. Returns null for both "no such
 * assignment" and "not a participant," and every caller responds 404 in
 * both cases (never 403) — the same non-disclosure convention already used
 * by GET /api/leader/follow-ups/:id/contacts, so a guessed id can never be
 * distinguished from a real one that isn't the caller's.
 */
async function loadAuthorizedAssignment(followUpAssignmentId: string, personId: string) {
  const assignment = await prisma.followUpAssignment.findUnique({ where: { id: followUpAssignmentId } });
  if (!assignment) return null;
  const role = resolveFollowUpConversationRole(personId, assignment);
  if (!role) return null;
  return { assignment, role };
}

// GET /api/follow-ups/:followUpAssignmentId/conversation — conversation
// metadata only (no messages).
router.get('/:followUpAssignmentId/conversation', asyncHandler(async (req, res) => {
  const { followUpAssignmentId } = req.params;
  const personId = req.followUpConversationActorPersonId!;

  const authorized = await loadAuthorizedAssignment(followUpAssignmentId, personId);
  if (!authorized) {
    return res.status(404).json({ error: 'Follow-up assignment not found.' });
  }

  const conversation = await getOrCreateFollowUpConversation(followUpAssignmentId);
  const unreadCount = await getFollowUpConversationUnreadCount(personId, conversation.id);
  res.json({
    id: conversation.id,
    followUpAssignmentId: conversation.followUpAssignmentId,
    createdAt: conversation.createdAt,
    assignmentStatus: authorized.assignment.status,
    unreadCount,
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

// GET /api/follow-ups/:followUpAssignmentId/conversation/messages —
// cursor-paginated, newest-first internally, returned oldest-first for
// direct rendering. `before` must be a message id that actually belongs to
// THIS conversation — never trusted as a bound on any other conversation's
// messages. Available regardless of assignment status: a closed
// assignment's original participants retain full historical read access.
router.get('/:followUpAssignmentId/conversation/messages', asyncHandler(async (req, res) => {
  const { followUpAssignmentId } = req.params;
  const personId = req.followUpConversationActorPersonId!;

  const authorized = await loadAuthorizedAssignment(followUpAssignmentId, personId);
  if (!authorized) {
    return res.status(404).json({ error: 'Follow-up assignment not found.' });
  }

  const parsed = listMessagesQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid pagination parameters.' });
  }
  const limit = Math.min(parsed.data.limit ?? DEFAULT_MESSAGE_PAGE_SIZE, MAX_MESSAGE_PAGE_SIZE);

  const conversation = await getOrCreateFollowUpConversation(followUpAssignmentId);

  let cursor: { createdAt: Date; id: string } | null = null;
  if (parsed.data.before) {
    const cursorMessage = await prisma.followUpMessage.findUnique({ where: { id: parsed.data.before } });
    if (!cursorMessage || cursorMessage.conversationId !== conversation.id) {
      return res.status(400).json({ error: 'Invalid pagination cursor.' });
    }
    cursor = { createdAt: cursorMessage.createdAt, id: cursorMessage.id };
  }

  const rows = await prisma.followUpMessage.findMany({
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
  const unreadCount = await getFollowUpConversationUnreadCount(personId, conversation.id);

  res.json({
    items: page.map((m) => ({ id: m.id, senderName: m.sender.name, body: m.body, createdAt: m.createdAt })),
    hasMore,
    unreadCount,
  });
}));

const sendMessageSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});

// POST /api/follow-ups/:followUpAssignmentId/conversation/messages —
// senderPersonId is always req.followUpConversationActorPersonId, never
// accepted from the body. Requires the assignment to be ACTIVE — a closed
// assignment's conversation is read-only for both participants.
router.post(
  '/:followUpAssignmentId/conversation/messages',
  followUpMessageSendLimiter,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const { followUpAssignmentId } = req.params;
    const personId = req.followUpConversationActorPersonId!;

    const authorized = await loadAuthorizedAssignment(followUpAssignmentId, personId);
    if (!authorized) {
      return res.status(404).json({ error: 'Follow-up assignment not found.' });
    }
    if (authorized.assignment.status !== 'ACTIVE') {
      return res.status(409).json({ error: 'This follow-up has been closed. The conversation is read-only.' });
    }

    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid message.' });
    }

    const conversation = await getOrCreateFollowUpConversation(followUpAssignmentId);

    const created = await prisma.followUpMessage.create({
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

// POST /api/follow-ups/:followUpAssignmentId/conversation/read — advances
// the caller's own read cursor. Deliberately does NOT gate on
// assignment.status: unlike sending, marking read (like GET above) remains
// available for a closed assignment's original participants, and never
// reopens or reactivates the assignment — it only ever writes to this
// Person's own read cursor.
router.post(
  '/:followUpAssignmentId/conversation/read',
  followUpConversationReadLimiter,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const { followUpAssignmentId } = req.params;
    const personId = req.followUpConversationActorPersonId!;

    const authorized = await loadAuthorizedAssignment(followUpAssignmentId, personId);
    if (!authorized) {
      return res.status(404).json({ error: 'Follow-up assignment not found.' });
    }

    const parsed = markReadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'A messageId is required.' });
    }

    const conversation = await getOrCreateFollowUpConversation(followUpAssignmentId);

    const message = await prisma.followUpMessage.findUnique({ where: { id: parsed.data.messageId } });
    if (!message || message.conversationId !== conversation.id) {
      return res.status(400).json({ error: 'Invalid message reference.' });
    }

    await markFollowUpConversationRead(personId, conversation.id, message.createdAt);
    const unreadCount = await getFollowUpConversationUnreadCount(personId, conversation.id);

    res.json({ unreadCount });
  }),
);

export default router;
