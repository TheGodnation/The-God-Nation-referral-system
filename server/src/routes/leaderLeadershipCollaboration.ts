import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { requireCsrf } from '../lib/csrf';
import { leadershipCollaborationMessageSendLimiter, leadershipCollaborationReadLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import { requireLinkedPerson } from '../lib/leadership';
import {
  getEligibleLeadershipCollaborationGenerations,
  canAccessLeadershipCollaboration,
  getOrCreateLeadershipCollaborationConversation,
  markLeadershipCollaborationConversationRead,
  getLeadershipCollaborationUnreadCount,
} from '../lib/leadershipCollaboration';

const router = Router();

// Phase 2B — same-generation Leader collaboration. Leader-only, exactly
// like leaderLeadershipProposals.ts and leaderPeers.ts's own /peers route —
// never reachable by an authenticated Member or Admin. requireLinkedPerson
// resolves req.leaderPersonId server-side; no route below ever accepts a
// client-supplied Person id, Community id, or generation as a basis for
// authorization — the URL's :generation is only ever checked against, never
// used to expand, what req.leaderPersonId is actually eligible for.
router.use(requireAuth, requireRole('LEADER'), requireLinkedPerson);

// A single non-disclosing 404 for both "this generation has no Headquarters
// tree to belong to" and "this generation exists but the caller is not
// eligible for it". A probed generation must never be distinguishable from
// one the caller is simply ineligible for.
async function requireLeadershipCollaborationAccess(generation: number, personId: string): Promise<boolean> {
  if (!Number.isInteger(generation) || generation < 0) return false;
  return canAccessLeadershipCollaboration(personId, generation);
}

// GET /api/leader/leadership-collaboration — every generation the
// requesting Leader is currently eligible for (see
// lib/leadershipCollaboration.ts), each with its own unread count. No
// pagination: a Leader's own eligible-generation set is derived from their
// own RoleAssignments, which is bounded by how many distinct Community
// leadership roles one Person can realistically hold — nothing like the
// unbounded message history below.
router.get('/leadership-collaboration', asyncHandler(async (req, res) => {
  const personId = req.leaderPersonId!;
  const generations = await getEligibleLeadershipCollaborationGenerations(personId);

  const items = await Promise.all(
    generations.map(async (generation) => {
      const conversation = await getOrCreateLeadershipCollaborationConversation(generation);
      const unreadCount = await getLeadershipCollaborationUnreadCount(personId, conversation.id);
      return { generation, unreadCount };
    }),
  );

  res.json({ items });
}));

const generationParamSchema = z.object({ generation: z.coerce.number().int().min(0) });

const DEFAULT_MESSAGE_PAGE_SIZE = 30;
const MAX_MESSAGE_PAGE_SIZE = 50;

const listMessagesQuerySchema = z.object({
  before: z.string().optional(),
  limit: z.coerce.number().int().min(1).optional(),
});

// GET /api/leader/leadership-collaboration/:generation/messages —
// cursor-paginated, newest-first internally, returned oldest-first for
// direct rendering — same shape as every other conversation surface's
// messages route in this codebase (Community/Follow-Up/Geography). `before`
// must be a message id that actually belongs to THIS generation's
// conversation — never trusted as a bound on any other conversation's
// messages.
router.get('/leadership-collaboration/:generation/messages', asyncHandler(async (req, res) => {
  const parsedParams = generationParamSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return res.status(404).json({ error: 'Leadership collaboration conversation not found.' });
  }
  const { generation } = parsedParams.data;
  const personId = req.leaderPersonId!;

  if (!(await requireLeadershipCollaborationAccess(generation, personId))) {
    return res.status(404).json({ error: 'Leadership collaboration conversation not found.' });
  }

  const parsed = listMessagesQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid pagination parameters.' });
  }
  const limit = Math.min(parsed.data.limit ?? DEFAULT_MESSAGE_PAGE_SIZE, MAX_MESSAGE_PAGE_SIZE);

  const conversation = await getOrCreateLeadershipCollaborationConversation(generation);

  let cursor: { createdAt: Date; id: string } | null = null;
  if (parsed.data.before) {
    const cursorMessage = await prisma.leadershipCollaborationMessage.findUnique({ where: { id: parsed.data.before } });
    if (!cursorMessage || cursorMessage.conversationId !== conversation.id) {
      return res.status(400).json({ error: 'Invalid pagination cursor.' });
    }
    cursor = { createdAt: cursorMessage.createdAt, id: cursorMessage.id };
  }

  const rows = await prisma.leadershipCollaborationMessage.findMany({
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
  const unreadCount = await getLeadershipCollaborationUnreadCount(personId, conversation.id);

  res.json({
    items: page.map((m) => ({ id: m.id, senderName: m.sender.name, body: m.body, createdAt: m.createdAt })),
    hasMore,
    unreadCount,
  });
}));

const sendMessageSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});

// POST /api/leader/leadership-collaboration/:generation/messages —
// senderPersonId is always req.leaderPersonId, never accepted from the
// body. A Leader may post into any generation they are currently eligible
// for (requireLeadershipCollaborationAccess) — never a generation they are
// merely curious about, never a generation asserted by the client beyond
// what their own RoleAssignments actually support.
router.post(
  '/leadership-collaboration/:generation/messages',
  leadershipCollaborationMessageSendLimiter,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const parsedParams = generationParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(404).json({ error: 'Leadership collaboration conversation not found.' });
    }
    const { generation } = parsedParams.data;
    const personId = req.leaderPersonId!;

    if (!(await requireLeadershipCollaborationAccess(generation, personId))) {
      return res.status(404).json({ error: 'Leadership collaboration conversation not found.' });
    }

    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid message.' });
    }

    const conversation = await getOrCreateLeadershipCollaborationConversation(generation);

    const created = await prisma.leadershipCollaborationMessage.create({
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

// POST /api/leader/leadership-collaboration/:generation/read — advances the
// caller's own read cursor. Reuses requireLeadershipCollaborationAccess and
// its uniform 404 (never 403), matching the Geography Conversation
// precedent.
router.post(
  '/leadership-collaboration/:generation/read',
  leadershipCollaborationReadLimiter,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const parsedParams = generationParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(404).json({ error: 'Leadership collaboration conversation not found.' });
    }
    const { generation } = parsedParams.data;
    const personId = req.leaderPersonId!;

    if (!(await requireLeadershipCollaborationAccess(generation, personId))) {
      return res.status(404).json({ error: 'Leadership collaboration conversation not found.' });
    }

    const parsed = markReadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'A messageId is required.' });
    }

    const conversation = await getOrCreateLeadershipCollaborationConversation(generation);

    const message = await prisma.leadershipCollaborationMessage.findUnique({ where: { id: parsed.data.messageId } });
    if (!message || message.conversationId !== conversation.id) {
      return res.status(400).json({ error: 'Invalid message reference.' });
    }

    await markLeadershipCollaborationConversationRead(personId, conversation.id, message.createdAt);
    const unreadCount = await getLeadershipCollaborationUnreadCount(personId, conversation.id);

    res.json({ unreadCount });
  }),
);

export default router;
