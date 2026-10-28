import { MAX_COMMENT_CHARS } from '../lib/textLimits';
import { reactorList } from '../lib/reactionList';
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
  NO_ENGAGEMENT,
  type HeadquartersEngagement,
} from '../lib/headquartersPosts';
import { REACTION_TYPES } from '../lib/updates';
import { createDownloadUrl, isStorageConfigured } from '../lib/storage';
import { getAuthorDisplay, getAuthorDisplaysByIds, type AuthorDisplay } from '../lib/authorToggle';
import { embedFor, type SocialProvider } from '../lib/socialEmbed';

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
// Media Phase 2 — metadata only (id/mediaType/originalFilename/byteSize),
// never a storageKey or a signed URL: a recipient always fetches a fresh,
// short-lived download URL from GET .../media/:mediaId/download-url below,
// exactly once they actually want to view/play/download one item, never as
// part of this list/detail payload. Up to MAX_HEADQUARTERS_POST_MEDIA
// items, in the order attached (position).
function toMediaResponse(media: { id: string; originalFilename: string; mimeType: string; byteSize: number; mediaType: string }[]) {
  return media.map((m) => ({ id: m.id, mediaType: m.mediaType, originalFilename: m.originalFilename, byteSize: m.byteSize }));
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
    voice?: string;
    linkUrl?: string | null;
    linkProvider?: string | null;
    media?: { id: string; originalFilename: string; mimeType: string; byteSize: number; mediaType: string }[];
  },
  engagement: HeadquartersEngagement,
  author: AuthorDisplay | null,
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
    reactionCounts: engagement.reactionCounts,
    myReaction: engagement.myReaction,
    media: toMediaResponse(p.media ?? []),
    // Section 15: null means the plain institutional "Central Authority" voice.
    author,
    // Share-into-app: which official name to show, and a TikTok/Instagram/
    // Facebook/YouTube player (its address rebuilt here, never stored).
    voice: p.voice ?? 'CENTRAL_AUTHORITY',
    embed: embedFor((p.linkProvider ?? null) as SocialProvider | null, p.linkUrl ?? null),
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
  const authors = await getAuthorDisplaysByIds(pageSlice.map((p) => p.authorPersonId));

  const pageItems = pageSlice.map((p) =>
    toRecipientResponse(
      p,
      engagement.get(p.id) ?? NO_ENGAGEMENT,
      authors.get(p.authorPersonId ?? '') ?? null,
    ),
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
    include: { media: { select: { id: true, originalFilename: true, mimeType: true, byteSize: true, mediaType: true }, orderBy: { position: 'asc' } } },
  });
  if (!post) {
    return res.status(404).json({ error: 'Headquarters post not found.' });
  }

  const engagement = await getHeadquartersPostEngagementCounts([id], personId);
  const author = await getAuthorDisplay(post.authorPersonId);
  res.json(toRecipientResponse(post, engagement.get(id) ?? NO_ENGAGEMENT, author));
}));

// GET /api/me/headquarters-posts/:id/media/:mediaId/download-url — mints a
// fresh, short-lived signed R2 download URL for exactly one of this post's
// media items. Same non-disclosure convention as every other route in this
// file: 404 (never 403) for a nonexistent post id, an unpublished/archived
// post, a post the caller doesn't qualify for, or a mediaId that doesn't
// belong to THIS post — a guessed id, or probing for whether media exists,
// can never be distinguished from any other reason this 404s. Never
// accepts a storageKey from the caller — the only storage key ever used
// here is the one already stored against THIS exact media row, so a
// recipient can never supply their own key to read an arbitrary R2 object.
router.get(
  '/:id/media/:mediaId/download-url',
  attachmentDownloadLimiter,
  asyncHandler(async (req, res) => {
    const personId = req.headquartersPostRecipientPersonId!;
    const { id, mediaId } = req.params;

    const canView = await personCanViewHeadquartersPost(personId, id);
    if (!canView) {
      return res.status(404).json({ error: 'Headquarters post not found.' });
    }

    const media = await prisma.headquartersPostMedia.findFirst({ where: { id: mediaId, headquartersPostId: id } });
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
  body: z.string().trim().min(1).max(MAX_COMMENT_CHARS),
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

const reactionBodySchema = z.object({ type: z.enum(REACTION_TYPES).optional() });

/** Everyone's reactions on one post: total, counts by type, and the viewer's own. */
async function reactionSummary(headquartersPostId: string, personId: string) {
  const rows = await prisma.headquartersPostReaction.findMany({ where: { headquartersPostId }, select: { personId: true, type: true } });
  const reactionCounts: Record<string, number> = {};
  for (const r of rows) reactionCounts[r.type] = (reactionCounts[r.type] ?? 0) + 1;
  return { reactionCount: rows.length, reactionCounts, myReaction: rows.find((r) => r.personId === personId)?.type ?? null };
}

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

    // An optional { type } picks one of the six reactions; none means LIKE.
    // Choosing again changes it (one reaction per person).
    const parsed = reactionBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: 'Invalid reaction.' });
    const type = parsed.data.type ?? 'LIKE';
    await prisma.headquartersPostReaction.upsert({
      where: { headquartersPostId_personId: { headquartersPostId: id, personId } },
      create: { headquartersPostId: id, personId, type },
      update: { type },
    });

    res.json({ id, viewerHasReacted: true, ...(await reactionSummary(id, personId)) });
  }),
);

// GET /api/me/headquarters-posts/:id/reactions — who liked it.
router.get('/:id/reactions', asyncHandler(async (req, res) => {
  const personId = req.headquartersPostRecipientPersonId!;
  if (!(await personCanViewHeadquartersPost(personId, req.params.id))) {
    return res.status(404).json({ error: 'Headquarters post not found.' });
  }
  const rows = await prisma.headquartersPostReaction.findMany({ where: { headquartersPostId: req.params.id }, select: { personId: true, type: true, createdAt: true } });
  res.json(await reactorList(rows.map((r) => ({ personId: r.personId, reaction: r.type, createdAt: r.createdAt })), { personId }));
}));

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

    res.json({ id, viewerHasReacted: false, ...(await reactionSummary(id, personId)) });
  }),
);

export default router;
