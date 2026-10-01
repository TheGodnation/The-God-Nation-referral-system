import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../lib/asyncHandler';
import { requireCsrf } from '../lib/csrf';
import {
  headquartersPostCommentLimiter,
  headquartersPostReactionLimiter,
  attachmentDownloadLimiter,
} from '../lib/rateLimit';
import { resolveActingPersonId } from '../lib/leadership';
import { parsePagination, paginatedResult } from '../lib/pagination';
import {
  computeVisibleHeadquartersPostsForPerson,
  personCanViewHeadquartersPost,
  getHeadquartersPostEngagementCounts,
} from '../lib/headquartersPosts';
import { createDownloadUrl, isStorageConfigured } from '../lib/storage';

declare global {
  namespace Express {
    interface Request {
      // The acting Member's or Leader's own linked Person id, set only by
      // requireHeadquartersPostRecipient below — never derived from client
      // input. Admin never gets one: Admin manages Headquarters Posts via
      // adminHeadquartersPosts.ts, it does not "receive" them through this
      // shared recipient surface — same exclusion already established by
      // announcements.ts/communityConversations.ts.
      headquartersPostRecipientPersonId?: string;
    }
  }
}

async function resolveHeadquartersPostRecipientPersonId(req: Request): Promise<string | null> {
  if (req.member) return req.member.personId;
  if (req.user?.role === 'LEADER') return resolveActingPersonId(req.user.id);
  return null;
}

async function requireHeadquartersPostRecipient(req: Request, res: Response, next: NextFunction) {
  const personId = await resolveHeadquartersPostRecipientPersonId(req);
  if (!personId) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  req.headquartersPostRecipientPersonId = personId;
  next();
}

const router = Router();

router.use(requireHeadquartersPostRecipient);

// Recipient-facing shape only: content, publishedAt, networkWide (drives the
// client's i18n-driven "From National Headquarters" source label), and
// shared engagement counts — never target Community ids/names, creator, or
// any other internal organizational detail. Deliberately excludes every
// unrelated Person field (WhatsApp, email, DOB, address, location,
// training/assessment progress, follow-up state, private messages).
// Media Phase 1 — metadata only (mediaType/originalFilename/byteSize), never
// a storageKey or a signed URL: a recipient always fetches a fresh,
// short-lived download URL from GET .../media/download-url below, exactly
// once they actually want to view/play/download it, never as part of this
// list/detail payload.
function toMediaResponse(m: { id: string; originalFilename: string; mimeType: string; byteSize: number; mediaType: string } | null) {
  if (!m) return null;
  return { mediaType: m.mediaType, originalFilename: m.originalFilename, byteSize: m.byteSize };
}

function toRecipientResponse(
  p: {
    id: string;
    titleEn: string;
    titleFr: string | null;
    bodyEn: string;
    bodyFr: string | null;
    publishedAt: Date | null;
    networkWide: boolean;
    media?: { id: string; originalFilename: string; mimeType: string; byteSize: number; mediaType: string } | null;
  },
  engagement: { commentCount: number; reactionCount: number; viewerHasReacted: boolean },
) {
  return {
    id: p.id,
    titleEn: p.titleEn,
    titleFr: p.titleFr,
    bodyEn: p.bodyEn,
    bodyFr: p.bodyFr,
    publishedAt: p.publishedAt,
    networkWide: p.networkWide,
    commentCount: engagement.commentCount,
    reactionCount: engagement.reactionCount,
    viewerHasReacted: engagement.viewerHasReacted,
    media: toMediaResponse(p.media ?? null),
  };
}

// GET /api/me/headquarters-posts — every published, non-archived post the
// caller currently qualifies for, newest-published-first, page-based
// pagination. The full eligible set is derived fresh on every request; only
// the current page's engagement counts are batch-queried.
router.get('/', asyncHandler(async (req, res) => {
  const personId = req.headquartersPostRecipientPersonId!;
  const { page, pageSize, skip, take } = parsePagination(req);

  const eligible = await computeVisibleHeadquartersPostsForPerson(personId);
  const pageSlice = eligible.slice(skip, skip + take);
  const engagement = await getHeadquartersPostEngagementCounts(pageSlice.map((p) => p.id), personId);

  const pageItems = pageSlice.map((p) =>
    toRecipientResponse(p, engagement.get(p.id) ?? { commentCount: 0, reactionCount: 0, viewerHasReacted: false }),
  );

  res.json(paginatedResult(pageItems, eligible.length, page, pageSize));
}));

// GET /api/me/headquarters-posts/:id — 404 (never 403) for a nonexistent id,
// an unpublished/archived post, or one the caller doesn't qualify for.
router.get('/:id', asyncHandler(async (req, res) => {
  const personId = req.headquartersPostRecipientPersonId!;
  const { id } = req.params;

  const canView = await personCanViewHeadquartersPost(personId, id);
  if (!canView) {
    return res.status(404).json({ error: 'Headquarters post not found.' });
  }

  const post = await prisma.headquartersPost.findUnique({
    where: { id },
    include: { media: { select: { id: true, originalFilename: true, mimeType: true, byteSize: true, mediaType: true } } },
  });
  if (!post) {
    return res.status(404).json({ error: 'Headquarters post not found.' });
  }

  const engagement = await getHeadquartersPostEngagementCounts([id], personId);
  res.json(toRecipientResponse(post, engagement.get(id) ?? { commentCount: 0, reactionCount: 0, viewerHasReacted: false }));
}));

// GET /api/me/headquarters-posts/:id/media/download-url — mints a fresh,
// short-lived signed R2 download URL for this post's one media item. Same
// non-disclosure convention as every other route in this file: 404 (never
// 403) for a nonexistent id, an unpublished/archived post, a post the
// caller doesn't qualify for, or one with no media at all — a guessed id,
// or probing for whether media exists, can never be distinguished from any
// other reason this 404s. Never accepts a storageKey from the caller —
// the only storage key ever used here is the one already stored against
// THIS post, so a recipient can never supply their own key to read an
// arbitrary R2 object.
router.get(
  '/:id/media/download-url',
  attachmentDownloadLimiter,
  asyncHandler(async (req, res) => {
    const personId = req.headquartersPostRecipientPersonId!;
    const { id } = req.params;

    const canView = await personCanViewHeadquartersPost(personId, id);
    if (!canView) {
      return res.status(404).json({ error: 'Headquarters post not found.' });
    }

    const media = await prisma.headquartersPostMedia.findUnique({ where: { headquartersPostId: id } });
    if (!media) {
      return res.status(404).json({ error: 'Headquarters post not found.' });
    }

    if (!isStorageConfigured()) {
      return res.status(503).json({ error: 'Media is not available right now.' });
    }

    const { url, expiresAt } = await createDownloadUrl({ storageKey: media.storageKey });
    res.json({ url, expiresAt, mediaType: media.mediaType, mimeType: media.mimeType });
  }),
);

const DEFAULT_COMMENT_PAGE_SIZE = 30;
const MAX_COMMENT_PAGE_SIZE = 50;

const listCommentsQuerySchema = z.object({
  before: z.string().optional(),
  limit: z.coerce.number().int().min(1).optional(),
});

// GET /api/me/headquarters-posts/:id/comments — cursor-paginated,
// newest-first internally, returned oldest-first for direct rendering.
// `before` must be a comment id that actually belongs to THIS post — never
// trusted as a bound on any other post's comments. One shared comment
// thread per canonical post, exactly what every eligible reader sees.
router.get('/:id/comments', asyncHandler(async (req, res) => {
  const personId = req.headquartersPostRecipientPersonId!;
  const { id } = req.params;

  const canView = await personCanViewHeadquartersPost(personId, id);
  if (!canView) {
    return res.status(404).json({ error: 'Headquarters post not found.' });
  }

  const parsed = listCommentsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid pagination parameters.' });
  }
  const limit = Math.min(parsed.data.limit ?? DEFAULT_COMMENT_PAGE_SIZE, MAX_COMMENT_PAGE_SIZE);

  let cursor: { createdAt: Date; id: string } | null = null;
  if (parsed.data.before) {
    const cursorComment = await prisma.headquartersPostComment.findUnique({ where: { id: parsed.data.before } });
    if (!cursorComment || cursorComment.headquartersPostId !== id) {
      return res.status(400).json({ error: 'Invalid pagination cursor.' });
    }
    cursor = { createdAt: cursorComment.createdAt, id: cursorComment.id };
  }

  const rows = await prisma.headquartersPostComment.findMany({
    where: {
      headquartersPostId: id,
      ...(cursor
        ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] }
        : {}),
    },
    include: { author: { select: { name: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).reverse();

  res.json({
    items: page.map((c) => ({
      id: c.id,
      authorName: c.author.name,
      isOwn: c.authorPersonId === personId,
      body: c.body,
      createdAt: c.createdAt,
    })),
    hasMore,
  });
}));

const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});

// POST /api/me/headquarters-posts/:id/comments — authorPersonId is always
// req.headquartersPostRecipientPersonId, never accepted from the body.
router.post(
  '/:id/comments',
  headquartersPostCommentLimiter,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const personId = req.headquartersPostRecipientPersonId!;
    const { id } = req.params;

    const canView = await personCanViewHeadquartersPost(personId, id);
    if (!canView) {
      return res.status(404).json({ error: 'Headquarters post not found.' });
    }

    const parsed = createCommentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid comment.' });
    }

    const created = await prisma.headquartersPostComment.create({
      data: { headquartersPostId: id, authorPersonId: personId, body: parsed.data.body },
      include: { author: { select: { name: true } } },
    });

    res.status(201).json({
      id: created.id,
      authorName: created.author.name,
      isOwn: true,
      body: created.body,
      createdAt: created.createdAt,
    });
  }),
);

// POST /api/me/headquarters-posts/:id/reaction — idempotent toggle-on
// (upsert on the (headquartersPostId, personId) unique constraint). One
// shared reaction set per canonical post — never per-Community copies.
router.post(
  '/:id/reaction',
  headquartersPostReactionLimiter,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const personId = req.headquartersPostRecipientPersonId!;
    const { id } = req.params;

    const canView = await personCanViewHeadquartersPost(personId, id);
    if (!canView) {
      return res.status(404).json({ error: 'Headquarters post not found.' });
    }

    await prisma.headquartersPostReaction.upsert({
      where: { headquartersPostId_personId: { headquartersPostId: id, personId } },
      create: { headquartersPostId: id, personId },
      update: {},
    });

    const reactionCount = await prisma.headquartersPostReaction.count({ where: { headquartersPostId: id } });
    res.json({ id, viewerHasReacted: true, reactionCount });
  }),
);

// DELETE /api/me/headquarters-posts/:id/reaction — idempotent toggle-off.
router.delete(
  '/:id/reaction',
  headquartersPostReactionLimiter,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const personId = req.headquartersPostRecipientPersonId!;
    const { id } = req.params;

    const canView = await personCanViewHeadquartersPost(personId, id);
    if (!canView) {
      return res.status(404).json({ error: 'Headquarters post not found.' });
    }

    await prisma.headquartersPostReaction.deleteMany({ where: { headquartersPostId: id, personId } });

    const reactionCount = await prisma.headquartersPostReaction.count({ where: { headquartersPostId: id } });
    res.json({ id, viewerHasReacted: false, reactionCount });
  }),
);

export default router;
