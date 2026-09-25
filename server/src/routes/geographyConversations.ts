import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireCsrf } from '../lib/csrf';
import { geographyMessageSendLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import { resolveActingPersonId } from '../lib/leadership';
import { canAccessGeographyConversation, getOrCreateGeographyConversation } from '../lib/geographyConversation';

declare global {
  namespace Express {
    interface Request {
      // Phase 3M.6: the acting Member's or Leader's own linked Person id,
      // set only by requireGeographyConversationActor below — never derived
      // from client input. Admin never gets one: there is no Admin
      // conversation-browsing route in this phase, mirroring Phase 3M.1/
      // 3M.2's own precedent. A distinct property from every other
      // conversation family's actor-id — this route stays fully
      // independent of communityConversations.ts/followUpConversations.ts.
      geographyConversationActorPersonId?: string;
    }
  }
}

/**
 * Resolves the caller's own Person identity — either an authenticated
 * Member (req.member, set by loadMemberSession) or an authenticated Leader
 * (req.user with role LEADER, resolved via the existing User.personId
 * link). An Admin's req.user is deliberately never resolved here, matching
 * every other conversation family in this codebase.
 */
async function resolveGeographyConversationActorPersonId(req: Request): Promise<string | null> {
  if (req.member) return req.member.personId;
  if (req.user?.role === 'LEADER') return resolveActingPersonId(req.user.id);
  return null;
}

async function requireGeographyConversationActor(req: Request, res: Response, next: NextFunction) {
  const personId = await resolveGeographyConversationActorPersonId(req);
  if (!personId) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  req.geographyConversationActorPersonId = personId;
  next();
}

const router = Router();

router.use(requireGeographyConversationActor);

// A single non-disclosing 404 for both "this Geography doesn't exist" and
// "this Geography exists but the caller has no access" — canAccessGeographyConversation
// returns false for a nonexistent id too (no real Person's GeographicAssignment
// or RoleAssignment can ever match a made-up id), so there is nothing else
// to check first. This deliberately differs from Community Conversation's
// 404-then-403 split: a probed Geography id must never be distinguishable
// from a made-up one.
async function requireGeographyConversationAccess(req: Request, res: Response, next: NextFunction) {
  const { geographyId } = req.params;
  const personId = req.geographyConversationActorPersonId!;
  if (!(await canAccessGeographyConversation(personId, geographyId))) {
    return res.status(404).json({ error: 'Geography conversation not found.' });
  }
  next();
}

// GET /api/geographies/:geographyId/conversation — conversation metadata
// only (no messages).
router.get(
  '/:geographyId/conversation',
  requireGeographyConversationAccess,
  asyncHandler(async (req, res) => {
    const { geographyId } = req.params;
    const conversation = await getOrCreateGeographyConversation(geographyId);
    res.json({ id: conversation.id, geographyId: conversation.geographyId, createdAt: conversation.createdAt });
  }),
);

const DEFAULT_MESSAGE_PAGE_SIZE = 30;
const MAX_MESSAGE_PAGE_SIZE = 50;

const listMessagesQuerySchema = z.object({
  before: z.string().optional(),
  // A requested limit above the maximum is capped, not rejected — a client
  // asking for "too much" is not a malformed request.
  limit: z.coerce.number().int().min(1).optional(),
});

// GET /api/geographies/:geographyId/conversation/messages — cursor-paginated,
// newest-first internally, returned oldest-first for direct rendering.
// `before` must be a message id that actually belongs to THIS conversation
// — never trusted as a bound on any other conversation's messages.
router.get(
  '/:geographyId/conversation/messages',
  requireGeographyConversationAccess,
  asyncHandler(async (req, res) => {
    const { geographyId } = req.params;

    const parsed = listMessagesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid pagination parameters.' });
    }
    const limit = Math.min(parsed.data.limit ?? DEFAULT_MESSAGE_PAGE_SIZE, MAX_MESSAGE_PAGE_SIZE);

    const conversation = await getOrCreateGeographyConversation(geographyId);

    let cursor: { createdAt: Date; id: string } | null = null;
    if (parsed.data.before) {
      const cursorMessage = await prisma.geographyMessage.findUnique({ where: { id: parsed.data.before } });
      if (!cursorMessage || cursorMessage.conversationId !== conversation.id) {
        return res.status(400).json({ error: 'Invalid pagination cursor.' });
      }
      cursor = { createdAt: cursorMessage.createdAt, id: cursorMessage.id };
    }

    const rows = await prisma.geographyMessage.findMany({
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

    res.json({
      items: page.map((m) => ({ id: m.id, senderName: m.sender.name, body: m.body, createdAt: m.createdAt })),
      hasMore,
    });
  }),
);

const sendMessageSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});

// POST /api/geographies/:geographyId/conversation/messages — senderPersonId
// is always req.geographyConversationActorPersonId, never accepted from the
// body. Either an ordinary resident of this Geography (or a descendant) or
// an exact-match Geography Leader may post — there is no leader-only
// posting restriction (Phase 3M.6's explicit two-way founder decision).
router.post(
  '/:geographyId/conversation/messages',
  geographyMessageSendLimiter,
  requireCsrf,
  requireGeographyConversationAccess,
  asyncHandler(async (req, res) => {
    const { geographyId } = req.params;
    const personId = req.geographyConversationActorPersonId!;

    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid message.' });
    }

    const conversation = await getOrCreateGeographyConversation(geographyId);

    const created = await prisma.geographyMessage.create({
      data: {
        conversationId: conversation.id,
        senderPersonId: personId,
        body: parsed.data.body,
      },
    });

    res.status(201).json({ id: created.id, body: created.body, createdAt: created.createdAt });
  }),
);

export default router;
