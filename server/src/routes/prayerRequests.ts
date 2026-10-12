import { Router, type Request, type Response, type NextFunction } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireCsrf } from '../lib/csrf';
import { asyncHandler } from '../lib/asyncHandler';
import { recordAudit } from '../lib/audit';
import { profilePhotoPath } from '../lib/profilePhoto';
import { prayerRequestLimiter, prayerRequestCommentLimiter } from '../lib/rateLimit';
import { notifyPrayerRequestComment, notifyPrayerRequestSubmittedPrivately } from '../lib/notifications';
import {
  resolvePrayerRequestViewer,
  canViewPrayerRequest,
  canModeratePrayerRequest,
  leaderCommunityIdsFor,
  getCommunityLeaderPersonIds,
  authorBelongsToCommunity,
  MAX_PRAYER_REQUEST_BODY,
  MAX_PRAYER_REQUEST_COMMENT_BODY,
  PRAYER_REQUESTS_PAGE_SIZE,
  type PrayerRequestViewer,
} from '../lib/prayerRequests';

// ---------------------------------------------------------------------------
// /api/prayer-requests — see PrayerRequestVisibility's schema comment for
// the PUBLIC/PRIVATE design. Same "any signed-in member, leader or admin
// can view" shape as /api/updates.
// ---------------------------------------------------------------------------

const router = Router();

declare global {
  namespace Express {
    interface Request {
      prayerRequestViewer?: PrayerRequestViewer;
    }
  }
}

const requireViewer = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const viewer = await resolvePrayerRequestViewer(req);
  if (!viewer) return res.status(401).json({ error: 'Please sign in.' });
  req.prayerRequestViewer = viewer;
  next();
});

function requirePerson(req: Request, res: Response, next: NextFunction) {
  if (!req.prayerRequestViewer?.personId) {
    return res.status(403).json({ error: 'Only members can do this.', code: 'MEMBERS_ONLY' });
  }
  next();
}

function deletedByFields(viewer: PrayerRequestViewer) {
  return viewer.isAdmin && viewer.userId
    ? { deletedByUserId: viewer.userId, deletedByPersonId: null }
    : { deletedByPersonId: viewer.personId, deletedByUserId: null };
}

const authorSelect = { id: true, name: true, photoStorageKey: true, photoUpdatedAt: true } as const;

// ----------------------------- Feed -----------------------------------------

const listQuerySchema = z.object({
  scope: z.enum(['public', 'private']).default('public'),
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(PRAYER_REQUESTS_PAGE_SIZE).optional(),
});

router.get('/', requireViewer, asyncHandler(async (req, res) => {
  const viewer = req.prayerRequestViewer!;
  const q = listQuerySchema.safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: 'Invalid request.' });

  let where: Prisma.PrayerRequestWhereInput;
  if (q.data.scope === 'public') {
    where = { visibility: 'PUBLIC', deletedAt: null };
  } else if (viewer.isAdmin) {
    where = { visibility: 'PRIVATE', deletedAt: null };
  } else if (viewer.personId) {
    const leaderCommunityIds = await leaderCommunityIdsFor(viewer);
    where = {
      visibility: 'PRIVATE',
      deletedAt: null,
      OR: [{ authorPersonId: viewer.personId }, ...(leaderCommunityIds.length ? [{ communityId: { in: leaderCommunityIds } }] : [])],
    };
  } else {
    where = { visibility: 'PRIVATE', deletedAt: null, authorPersonId: '__none__' };
  }
  if (q.data.before) where = { ...where, createdAt: { lt: new Date(q.data.before) } };

  const pageSize = q.data.limit ?? PRAYER_REQUESTS_PAGE_SIZE;
  const rows = await prisma.prayerRequest.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: pageSize + 1,
    include: {
      author: { select: authorSelect },
      community: { select: { id: true, name: true } },
      _count: { select: { comments: { where: { deletedAt: null } } } },
    },
  });
  const hasMore = rows.length > pageSize;
  const page = rows.slice(0, pageSize);

  res.json({
    viewer: { canPost: viewer.personId !== null, personId: viewer.personId },
    items: page.map((r) => ({
      id: r.id,
      author: { personId: r.author.id, name: r.author.name, photoUrl: profilePhotoPath(r.author) },
      body: r.body,
      visibility: r.visibility,
      community: r.community ? { id: r.community.id, name: r.community.name } : null,
      createdAt: r.createdAt,
      commentCount: r._count.comments,
      canDelete: viewer.isAdmin || (viewer.personId !== null && r.author.id === viewer.personId),
    })),
    nextBefore: hasMore ? page[page.length - 1].createdAt.toISOString() : null,
  });
}));

const createSchema = z.object({
  body: z.string().trim().min(1).max(MAX_PRAYER_REQUEST_BODY),
  visibility: z.enum(['PUBLIC', 'PRIVATE']),
  communityId: z.string().uuid().optional(),
});

router.post('/', prayerRequestLimiter, requireCsrf, requireViewer, requirePerson, asyncHandler(async (req, res) => {
  const personId = req.prayerRequestViewer!.personId!;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request.' });
  const d = parsed.data;

  let communityId: string | null = null;
  if (d.visibility === 'PRIVATE') {
    if (d.communityId) {
      if (!(await authorBelongsToCommunity(personId, d.communityId))) {
        return res.status(400).json({ error: 'You do not belong to that Community.' });
      }
      communityId = d.communityId;
    } else {
      // Most members belong to exactly one Community — auto-select it so
      // the compose form never has to ask. Zero or several memberships is
      // the rare edge case that genuinely needs an explicit choice.
      const memberships = await prisma.communityMembership.findMany({
        where: { personId, status: 'ACTIVE' },
        select: { communityId: true },
      });
      if (memberships.length === 0) {
        return res.status(400).json({ error: 'You do not belong to a Community yet.', code: 'NO_COMMUNITY' });
      }
      if (memberships.length > 1) {
        return res.status(400).json({ error: 'Choose which Community this is for.', code: 'COMMUNITY_REQUIRED' });
      }
      communityId = memberships[0].communityId;
    }
  }

  const request = await prisma.prayerRequest.create({
    data: { authorPersonId: personId, body: d.body, visibility: d.visibility, communityId },
    select: { id: true, authorPersonId: true },
  });

  if (d.visibility === 'PRIVATE' && communityId) {
    const leaderPersonIds = await getCommunityLeaderPersonIds(communityId);
    await notifyPrayerRequestSubmittedPrivately(request, leaderPersonIds);
  }

  res.status(201).json({ id: request.id });
}));

router.delete('/:id', prayerRequestLimiter, requireCsrf, requireViewer, asyncHandler(async (req, res) => {
  const viewer = req.prayerRequestViewer!;
  const request = await prisma.prayerRequest.findUnique({ where: { id: req.params.id } });
  if (!request || request.deletedAt) return res.status(404).json({ error: 'Prayer request not found.' });
  const isAuthor = viewer.personId !== null && request.authorPersonId === viewer.personId;
  if (!isAuthor && !(await canModeratePrayerRequest(viewer, request))) {
    return res.status(403).json({ error: 'You cannot delete this prayer request.' });
  }

  await prisma.prayerRequest.update({ where: { id: request.id }, data: { deletedAt: new Date(), ...deletedByFields(viewer) } });
  await recordAudit({
    actorId: viewer.userId,
    action: isAuthor ? 'PRAYER_REQUEST_DELETED_BY_AUTHOR' : 'PRAYER_REQUEST_REMOVED_BY_MODERATOR',
    targetType: 'PrayerRequest',
    targetId: request.id,
    metadata: { authorPersonId: request.authorPersonId, byPersonId: viewer.personId },
  });
  res.json({ ok: true });
}));

// ----------------------------- Comments --------------------------------------

async function loadVisibleRequest(id: string, viewer: PrayerRequestViewer) {
  const request = await prisma.prayerRequest.findUnique({ where: { id } });
  if (!request || request.deletedAt) return null;
  return (await canViewPrayerRequest(viewer, request)) ? request : null;
}

router.get('/:id/comments', requireViewer, asyncHandler(async (req, res) => {
  const viewer = req.prayerRequestViewer!;
  const request = await loadVisibleRequest(req.params.id, viewer);
  // 404 rather than 403 for a PRIVATE request the viewer may not see — the
  // response never confirms whether the id even exists, matching
  // notifications.ts's own convention for another person's row.
  if (!request) return res.status(404).json({ error: 'Prayer request not found.' });

  const canModerate = await canModeratePrayerRequest(viewer, request);
  const comments = await prisma.prayerRequestComment.findMany({
    where: { prayerRequestId: req.params.id, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    take: 200,
    include: { author: { select: authorSelect } },
  });
  res.json({
    items: comments.map((c) => ({
      id: c.id,
      author: { personId: c.author.id, name: c.author.name, photoUrl: profilePhotoPath(c.author) },
      body: c.body,
      createdAt: c.createdAt,
      canDelete: viewer.isAdmin || canModerate || (viewer.personId !== null && c.author.id === viewer.personId),
    })),
  });
}));

const commentSchema = z.object({ body: z.string().trim().min(1).max(MAX_PRAYER_REQUEST_COMMENT_BODY) });

router.post('/:id/comments', prayerRequestCommentLimiter, requireCsrf, requireViewer, requirePerson, asyncHandler(async (req, res) => {
  const viewer = req.prayerRequestViewer!;
  const parsed = commentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Write a comment first.' });

  const request = await loadVisibleRequest(req.params.id, viewer);
  if (!request) return res.status(404).json({ error: 'Prayer request not found.' });

  const comment = await prisma.prayerRequestComment.create({
    data: { prayerRequestId: req.params.id, authorPersonId: viewer.personId!, body: parsed.data.body },
    select: { id: true },
  });
  await notifyPrayerRequestComment(request as { id: string; authorPersonId: string }, viewer.personId!);
  res.status(201).json({ id: comment.id });
}));

router.delete('/comments/:commentId', prayerRequestCommentLimiter, requireCsrf, requireViewer, asyncHandler(async (req, res) => {
  const viewer = req.prayerRequestViewer!;
  const comment = await prisma.prayerRequestComment.findUnique({
    where: { id: req.params.commentId },
    include: { prayerRequest: true },
  });
  if (!comment || comment.deletedAt) return res.status(404).json({ error: 'Comment not found.' });
  const isAuthor = viewer.personId !== null && comment.authorPersonId === viewer.personId;
  if (!isAuthor && !(await canModeratePrayerRequest(viewer, comment.prayerRequest))) {
    return res.status(403).json({ error: 'You cannot delete this comment.' });
  }

  await prisma.prayerRequestComment.update({
    where: { id: comment.id },
    data: { deletedAt: new Date(), ...deletedByFields(viewer) },
  });
  await recordAudit({
    actorId: viewer.userId,
    action: isAuthor ? 'PRAYER_REQUEST_COMMENT_DELETED_BY_AUTHOR' : 'PRAYER_REQUEST_COMMENT_REMOVED_BY_MODERATOR',
    targetType: 'PrayerRequestComment',
    targetId: comment.id,
    metadata: { prayerRequestId: comment.prayerRequestId, byPersonId: viewer.personId },
  });
  res.json({ ok: true });
}));

export default router;
