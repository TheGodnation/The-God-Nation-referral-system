import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { asyncHandler } from '../lib/asyncHandler';
import { recordAudit } from '../lib/audit';
import { centralAuthorityOversightLimiter } from '../lib/rateLimit';
import { contextTargetExists } from '../lib/leadership';
import { getOrCreateConversation } from '../lib/communityConversation';
import { getOrCreateFollowUpConversation } from '../lib/followUpConversation';
import { getOrCreateGeographyConversation } from '../lib/geographyConversation';
import { isStorageConfigured, createDownloadUrl } from '../lib/storage';

// ---------------------------------------------------------------------------
// Phase 3M.8B — Central Authority Conversation Oversight.
//
// Central Authority is the existing Role.ADMIN — no new role, model, or
// permission engine. Every route here is READ-ONLY: there is no POST/PATCH/
// DELETE anywhere in this file, so there is no code path by which opening
// one of these routes could send a message, moderate content, or manage
// participants. Admin's authority here is its platform-wide ADMIN role
// only — never a client-supplied Person id, never the ordinary
// hasConversationAccess/resolveFollowUpConversationRole/
// canAccessGeographyConversation checks (all three remain completely
// unmodified and are never called from this file), so Central Authority
// never becomes a participant, never gains a read cursor, and never affects
// any *ConversationRead model merely by inspecting.
//
// Every successful inspection requires a controlled reason (SECURITY,
// FRAUD_OR_DECEPTION, ABUSE_OR_SAFEGUARDING, ORGANIZATIONAL_REVIEW, or OTHER
// with a short explanation) and is recorded via the existing recordAudit —
// no new audit mechanism, no message bodies or conversation content ever
// written to AuditLog, only conversationId/reason/target identifiers in its
// existing metadata JSON column. A request with a missing/invalid reason
// never reaches conversation data at all: validation happens before any
// conversation is loaded.
// ---------------------------------------------------------------------------

const router = Router();

router.use(requireAuth, requireRole('ADMIN'));

const OVERSIGHT_REASONS = ['SECURITY', 'FRAUD_OR_DECEPTION', 'ABUSE_OR_SAFEGUARDING', 'ORGANIZATIONAL_REVIEW', 'OTHER'] as const;

const oversightQuerySchema = z
  .object({
    reason: z.enum(OVERSIGHT_REASONS),
    // Short by design — this is a one-line justification for an audit
    // trail, not a case file. Shorter than the 1000/2000-char "note" fields
    // used elsewhere in this codebase (FollowUpContact.note,
    // LeadershipProposal.note), deliberately, since a longer investigative
    // record belongs in the organization's own process, not here.
    reasonNote: z.string().trim().max(500).optional(),
    before: z.string().optional(),
    // A requested limit above the maximum is capped, not rejected — same
    // convention as every other paginated conversation route.
    limit: z.coerce.number().int().min(1).optional(),
  })
  .refine((d) => d.reason !== 'OTHER' || Boolean(d.reasonNote && d.reasonNote.length > 0), {
    message: 'A short explanation is required when reason is OTHER.',
    path: ['reasonNote'],
  });

function reasonMetadata(reason: (typeof OVERSIGHT_REASONS)[number], reasonNote: string | undefined) {
  return reason === 'OTHER' ? { reason, reasonNote } : { reason };
}

const DEFAULT_MESSAGE_PAGE_SIZE = 30;
const MAX_MESSAGE_PAGE_SIZE = 50;

// GET /api/admin/communities/:communityId/conversation/messages — Central
// Authority inspection of a Community's conversation. Unlike the
// participant-facing GET in communityConversations.ts, a moderated
// (Phase 3M.8A soft-deleted) message's ORIGINAL body is included here,
// exactly as that phase's own schema comment promised ("preserved for
// future Central Authority investigative access, never exposed" to
// ordinary participants) — `deleted`/`deletedAt` are also included so
// Central Authority can see both what was said and that it was later
// removed, by whom.
router.get(
  '/communities/:communityId/conversation/messages',
  centralAuthorityOversightLimiter,
  asyncHandler(async (req, res) => {
    const { communityId } = req.params;

    if (!(await contextTargetExists('COMMUNITY', communityId))) {
      return res.status(404).json({ error: 'Community not found.' });
    }

    const parsed = oversightQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'A valid reason is required.' });
    }
    const { reason, reasonNote, before, limit: rawLimit } = parsed.data;
    const limit = Math.min(rawLimit ?? DEFAULT_MESSAGE_PAGE_SIZE, MAX_MESSAGE_PAGE_SIZE);

    const conversation = await getOrCreateConversation(communityId);

    let cursor: { createdAt: Date; id: string } | null = null;
    if (before) {
      const cursorMessage = await prisma.message.findUnique({ where: { id: before } });
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
      include: {
        sender: { select: { name: true } },
        deletedBy: { select: { name: true } },
        // Phase 3M.8C — attachment METADATA only (id/filename/mime/size).
        // Never the storageKey and never a signed URL here: an actual
        // download always goes through the dedicated, freshly-authorized
        // route below, so nothing resolvable to file bytes is ever
        // returned by this listing endpoint or written into AuditLog.
        attachments: { select: { id: true, originalFilename: true, mimeType: true, byteSize: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).reverse();

    await recordAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'CENTRAL_AUTHORITY_COMMUNITY_CONVERSATION_VIEWED',
      targetType: 'Community',
      targetId: communityId,
      metadata: { conversationId: conversation.id, ...reasonMetadata(reason, reasonNote) },
    });

    res.json({
      items: page.map((m) => ({
        id: m.id,
        senderName: m.sender.name,
        body: m.body,
        createdAt: m.createdAt,
        deleted: Boolean(m.deletedAt),
        deletedAt: m.deletedAt,
        deletedByName: m.deletedBy?.name ?? null,
        // Unredacted regardless of moderation state — this oversight
        // listing has always shown deleted messages' original body too
        // (see above); attachment metadata follows the same rule.
        attachments: m.attachments.map((a) => ({ id: a.id, originalFilename: a.originalFilename, mimeType: a.mimeType, byteSize: a.byteSize })),
      })),
      hasMore,
    });
  }),
);

// GET /api/admin/communities/:communityId/attachments/:attachmentId/download-url
// — Phase 3M.8C. Extends the existing Community oversight surface only (no
// second oversight mechanism): same controlled reason gate, same
// centralAuthorityOversightLimiter, same recordAudit. Resolves
// attachment -> message -> conversation -> Community and confirms they all
// match communityId before ever touching R2, exactly like the message
// listing route above never trusts a bare id. Mints a fresh signed URL on
// every call — never persisted, never included in AuditLog metadata.
router.get(
  '/communities/:communityId/attachments/:attachmentId/download-url',
  centralAuthorityOversightLimiter,
  asyncHandler(async (req, res) => {
    const { communityId, attachmentId } = req.params;

    if (!(await contextTargetExists('COMMUNITY', communityId))) {
      return res.status(404).json({ error: 'Community not found.' });
    }

    const parsed = oversightQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'A valid reason is required.' });
    }
    const { reason, reasonNote } = parsed.data;

    const conversation = await getOrCreateConversation(communityId);

    const attachment = await prisma.messageAttachment.findUnique({
      where: { id: attachmentId },
      include: { message: true },
    });
    if (!attachment || attachment.message.conversationId !== conversation.id) {
      return res.status(404).json({ error: 'Attachment not found.' });
    }

    if (!isStorageConfigured()) {
      return res.status(503).json({ error: 'Attachments are not available right now.' });
    }

    const { url, expiresAt } = await createDownloadUrl({ storageKey: attachment.storageKey });

    await recordAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'CENTRAL_AUTHORITY_ATTACHMENT_ACCESSED',
      targetType: 'MessageAttachment',
      targetId: attachmentId,
      metadata: {
        communityId,
        conversationId: conversation.id,
        messageId: attachment.messageId,
        ...reasonMetadata(reason, reasonNote),
      },
    });

    res.json({ url, expiresAt });
  }),
);

// GET /api/admin/geographies/:geographyId/conversation/messages — Central
// Authority inspection of a Geography's conversation. GeographyMessage has
// no moderation fields (Phase 3M.8A was Community-only), so there is
// nothing to unredact here — this simply returns the same message history
// participants see, via a separate, reason-gated, audited, Admin-only path.
router.get(
  '/geographies/:geographyId/conversation/messages',
  centralAuthorityOversightLimiter,
  asyncHandler(async (req, res) => {
    const { geographyId } = req.params;

    if (!(await contextTargetExists('GEOGRAPHY', geographyId))) {
      return res.status(404).json({ error: 'Geography not found.' });
    }

    const parsed = oversightQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'A valid reason is required.' });
    }
    const { reason, reasonNote, before, limit: rawLimit } = parsed.data;
    const limit = Math.min(rawLimit ?? DEFAULT_MESSAGE_PAGE_SIZE, MAX_MESSAGE_PAGE_SIZE);

    const conversation = await getOrCreateGeographyConversation(geographyId);

    let cursor: { createdAt: Date; id: string } | null = null;
    if (before) {
      const cursorMessage = await prisma.geographyMessage.findUnique({ where: { id: before } });
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

    await recordAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'CENTRAL_AUTHORITY_GEOGRAPHY_CONVERSATION_VIEWED',
      targetType: 'Geography',
      targetId: geographyId,
      metadata: { conversationId: conversation.id, ...reasonMetadata(reason, reasonNote) },
    });

    res.json({
      items: page.map((m) => ({ id: m.id, senderName: m.sender.name, body: m.body, createdAt: m.createdAt })),
      hasMore,
    });
  }),
);

// GET /api/admin/follow-ups/:followUpAssignmentId/conversation/messages —
// Central Authority inspection of a private Follow-Up conversation. This is
// the most sensitive of the three, hence the same reason-gate as the other
// two but with the additional followerId/followedPersonId recorded in the
// audit metadata. Authorization is existence-only (404 if the assignment
// doesn't exist) — deliberately NOT resolveFollowUpConversationRole, which
// answers a completely different question ("is this Person one of the two
// participants") that doesn't apply to Central Authority's role-based
// authority. Available regardless of assignment status (ACTIVE or CLOSED),
// matching the existing GET /api/admin/follow-ups/:id/contacts precedent —
// an investigation frequently concerns a relationship that has since closed.
router.get(
  '/follow-ups/:followUpAssignmentId/conversation/messages',
  centralAuthorityOversightLimiter,
  asyncHandler(async (req, res) => {
    const { followUpAssignmentId } = req.params;

    const assignment = await prisma.followUpAssignment.findUnique({ where: { id: followUpAssignmentId } });
    if (!assignment) {
      return res.status(404).json({ error: 'Follow-up assignment not found.' });
    }

    const parsed = oversightQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'A valid reason is required.' });
    }
    const { reason, reasonNote, before, limit: rawLimit } = parsed.data;
    const limit = Math.min(rawLimit ?? DEFAULT_MESSAGE_PAGE_SIZE, MAX_MESSAGE_PAGE_SIZE);

    const conversation = await getOrCreateFollowUpConversation(followUpAssignmentId);

    let cursor: { createdAt: Date; id: string } | null = null;
    if (before) {
      const cursorMessage = await prisma.followUpMessage.findUnique({ where: { id: before } });
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

    await recordAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'CENTRAL_AUTHORITY_FOLLOWUP_CONVERSATION_VIEWED',
      targetType: 'FollowUpAssignment',
      targetId: followUpAssignmentId,
      metadata: {
        conversationId: conversation.id,
        followUpAssignmentId,
        followerId: assignment.followerId,
        followedPersonId: assignment.followedPersonId,
        ...reasonMetadata(reason, reasonNote),
      },
    });

    res.json({
      items: page.map((m) => ({ id: m.id, senderName: m.sender.name, body: m.body, createdAt: m.createdAt })),
      hasMore,
    });
  }),
);

export default router;
