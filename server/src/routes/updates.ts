import { Router, type Request, type Response, type NextFunction } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireCsrf } from '../lib/csrf';
import { requireAuth, requireRole } from '../lib/auth';
import { recordAudit } from '../lib/audit';
import { asyncHandler } from '../lib/asyncHandler';
import { isStorageConfigured, createUploadUrl, createDownloadUrl, headObject } from '../lib/storage';
import { ATTACHMENT_MIME_LIMITS } from '../lib/attachmentPolicy';
import { profilePhotoPath } from '../lib/profilePhoto';
import {
  attachmentUploadAuthorizeLimiter,
  updatePostLimiter,
  updateCommentLimiter,
  updateReactionLimiter,
  communityMutationLimiter,
} from '../lib/rateLimit';
import {
  resolveUpdatesViewer,
  parseYoutubeVideoId,
  generateUpdatePhotoStorageKey,
  isStorageKeyForUpdatePhoto,
  MAX_PHOTOS_PER_UPDATE,
  MAX_UPDATE_BODY,
  MAX_COMMENT_BODY,
  UPDATES_PAGE_SIZE,
  REACTION_TYPES,
  type UpdatesViewer,
} from '../lib/updates';
import { getBlockedIds, getFriendIds } from '../lib/social';

// ---------------------------------------------------------------------------
// /api/updates — the community-wide Updates feed (see UpdatePost schema).
// ---------------------------------------------------------------------------

const router = Router();

declare global {
  namespace Express {
    interface Request {
      updatesViewer?: UpdatesViewer;
    }
  }
}

const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Any signed-in member, leader or admin. */
const requireViewer = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const viewer = await resolveUpdatesViewer(req);
  if (!viewer) return res.status(401).json({ error: 'Please sign in.' });
  req.updatesViewer = viewer;
  next();
});

/** Viewer who has a Person identity (needed to post, comment or react). */
function requirePerson(req: Request, res: Response, next: NextFunction) {
  if (!req.updatesViewer?.personId) {
    return res.status(403).json({ error: 'Only members can do this.', code: 'MEMBERS_ONLY' });
  }
  next();
}

function deletedByFields(viewer: UpdatesViewer) {
  // Record the admin account when an admin acted; otherwise the person.
  return viewer.isAdmin && viewer.userId
    ? { deletedByUserId: viewer.userId, deletedByPersonId: null }
    : { deletedByPersonId: viewer.personId, deletedByUserId: null };
}

// ----------------------------- Live slot -----------------------------------

router.get('/live', requireViewer, asyncHandler(async (_req, res) => {
  const s = await prisma.settings.findUnique({
    where: { id: 'singleton' },
    select: { liveYoutubeVideoId: true, liveTitle: true, liveStartedAt: true },
  });
  if (!s?.liveYoutubeVideoId) return res.json({ live: null });
  res.json({ live: { youtubeVideoId: s.liveYoutubeVideoId, title: s.liveTitle, startedAt: s.liveStartedAt } });
}));

const liveSchema = z.object({
  youtubeUrl: z.string().trim().min(1).max(500),
  title: z.string().trim().max(200).optional(),
});

// PUT /api/updates/live — central admin only: show a YouTube live (video
// or audio-only) at the top of everyone's Updates page.
router.put('/live', requireAuth, requireRole('ADMIN'), communityMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = liveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Please paste the YouTube link of the live.' });
  const videoId = parseYoutubeVideoId(parsed.data.youtubeUrl);
  if (!videoId) return res.status(400).json({ error: 'That does not look like a YouTube link.', code: 'INVALID_YOUTUBE' });

  const data = { liveYoutubeVideoId: videoId, liveTitle: parsed.data.title || null, liveStartedAt: new Date() };
  await prisma.settings.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', ...data }, update: data });
  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'UPDATES_LIVE_STARTED',
    targetType: 'Settings',
    targetId: 'singleton',
    metadata: { youtubeVideoId: videoId },
  });
  res.json({ live: { youtubeVideoId: videoId, title: data.liveTitle, startedAt: data.liveStartedAt } });
}));

router.delete('/live', requireAuth, requireRole('ADMIN'), communityMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const data = { liveYoutubeVideoId: null, liveTitle: null, liveStartedAt: null };
  await prisma.settings.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', ...data }, update: data });
  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'UPDATES_LIVE_ENDED',
    targetType: 'Settings',
    targetId: 'singleton',
  });
  res.json({ live: null });
}));

// ----------------------------- Photos --------------------------------------

const authorizePhotoSchema = z.object({ mimeType: z.string().min(1), byteSize: z.number().int().positive() });

router.post('/photos/authorize', attachmentUploadAuthorizeLimiter, requireCsrf, requireViewer, requirePerson, asyncHandler(async (req, res) => {
  const parsed = authorizePhotoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid photo.' });
  const { mimeType, byteSize } = parsed.data;
  if (!PHOTO_MIME_TYPES.includes(mimeType)) {
    return res.status(400).json({ error: 'Please choose a JPG, PNG or WebP picture.', code: 'UNSUPPORTED_TYPE' });
  }
  const maxBytes = ATTACHMENT_MIME_LIMITS[mimeType];
  if (byteSize > maxBytes) return res.status(400).json({ error: 'This picture is too large.', code: 'TOO_LARGE' });
  if (!isStorageConfigured()) {
    return res.status(503).json({ error: 'Photo uploads are not available right now.', code: 'STORAGE_UNAVAILABLE' });
  }
  const storageKey = generateUpdatePhotoStorageKey(req.updatesViewer!.personId!);
  const { url, expiresAt } = await createUploadUrl({ storageKey, mimeType });
  res.json({ storageKey, uploadUrl: url, expiresAt, maxBytes });
}));

// GET /api/updates/photos/:photoId — short-lived signed link to a photo of
// a post that is still visible. Signed-in viewers only.
router.get('/photos/:photoId', requireViewer, asyncHandler(async (req, res) => {
  const photo = await prisma.updatePostPhoto.findUnique({
    where: { id: req.params.photoId },
    select: { storageKey: true, post: { select: { deletedAt: true } } },
  });
  if (!photo || photo.post.deletedAt || !isStorageConfigured()) return res.status(404).json({ error: 'Not found.' });
  const { url } = await createDownloadUrl({ storageKey: photo.storageKey });
  res.setHeader('Cache-Control', 'private, max-age=240');
  res.redirect(302, url);
}));

// GET /api/updates/photo-wall?authorPersonId=… — the photos someone has
// posted, newest first, for the "Photos" tab on their profile wall. Hidden
// when either person blocked the other (moderators still see them).
const photoWallSchema = z.object({ authorPersonId: z.string().uuid() });

router.get('/photo-wall', requireViewer, asyncHandler(async (req, res) => {
  const viewer = req.updatesViewer!;
  const q = photoWallSchema.safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: 'Invalid request.' });
  const authorPersonId = q.data.authorPersonId;
  if (viewer.personId && !viewer.canModerate) {
    const blocked = await getBlockedIds(viewer.personId);
    if (blocked.includes(authorPersonId)) return res.json({ items: [] });
  }
  const photos = await prisma.updatePostPhoto.findMany({
    where: { post: { authorPersonId, deletedAt: null } },
    orderBy: [{ post: { createdAt: 'desc' } }, { position: 'asc' }],
    take: 60,
    select: { id: true, postId: true },
  });
  res.json({ items: photos.map((ph) => ({ id: ph.id, postId: ph.postId, url: `/api/updates/photos/${ph.id}` })) });
}));

// ----------------------------- Comments (by id) ----------------------------

router.delete('/comments/:commentId', updateCommentLimiter, requireCsrf, requireViewer, asyncHandler(async (req, res) => {
  const viewer = req.updatesViewer!;
  const comment = await prisma.updateComment.findUnique({ where: { id: req.params.commentId } });
  if (!comment || comment.deletedAt) return res.status(404).json({ error: 'Comment not found.' });
  const isAuthor = viewer.personId !== null && comment.authorPersonId === viewer.personId;
  if (!isAuthor && !viewer.canModerate) return res.status(403).json({ error: 'You cannot delete this comment.' });

  await prisma.updateComment.update({
    where: { id: comment.id },
    data: { deletedAt: new Date(), ...deletedByFields(viewer) },
  });
  await recordAudit({
    actorId: viewer.userId,
    action: isAuthor ? 'UPDATE_COMMENT_DELETED_BY_AUTHOR' : 'UPDATE_COMMENT_REMOVED_BY_MODERATOR',
    targetType: 'UpdateComment',
    targetId: comment.id,
    metadata: { postId: comment.postId, byPersonId: viewer.personId },
  });
  res.json({ ok: true });
}));

// ----------------------------- Feed ----------------------------------------

const listQuerySchema = z.object({
  before: z.string().datetime().optional(),
  authorPersonId: z.string().uuid().optional(),
  // friends=true: only posts from the viewer's friends (and the viewer).
  friends: z.enum(['true', 'false']).optional(),
});

router.get('/', requireViewer, asyncHandler(async (req, res) => {
  const viewer = req.updatesViewer!;
  const q = listQuerySchema.safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: 'Invalid request.' });

  // Members never see posts from people they blocked or who blocked them;
  // the Friends view narrows to friends (plus the viewer's own posts).
  const hiddenAuthors = viewer.personId ? await getBlockedIds(viewer.personId) : [];
  const friendsOnly = q.data.friends === 'true' && viewer.personId !== null;
  const friendAuthors = friendsOnly ? [...(await getFriendIds(viewer.personId!)), viewer.personId!] : null;

  const authorFilters: Prisma.UpdatePostWhereInput[] = [];
  if (hiddenAuthors.length && !viewer.canModerate) authorFilters.push({ authorPersonId: { notIn: hiddenAuthors } });
  if (friendAuthors) authorFilters.push({ authorPersonId: { in: friendAuthors } });
  if (q.data.authorPersonId) authorFilters.push({ authorPersonId: q.data.authorPersonId });

  const posts = await prisma.updatePost.findMany({
    where: {
      deletedAt: null,
      AND: authorFilters,
      ...(q.data.before ? { createdAt: { lt: new Date(q.data.before) } } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: UPDATES_PAGE_SIZE + 1,
    include: {
      author: { select: { id: true, name: true, photoStorageKey: true, photoUpdatedAt: true } },
      photos: { orderBy: { position: 'asc' }, select: { id: true } },
      _count: { select: { comments: { where: { deletedAt: null } } } },
    },
  });
  const hasMore = posts.length > UPDATES_PAGE_SIZE;
  const page = posts.slice(0, UPDATES_PAGE_SIZE);
  const ids = page.map((p) => p.id);

  const [reactionGroups, myReactions] = await Promise.all([
    ids.length
      ? prisma.updateReaction.groupBy({ by: ['postId', 'type'], where: { postId: { in: ids } }, _count: { _all: true } })
      : Promise.resolve([] as { postId: string; type: string; _count: { _all: number } }[]),
    viewer.personId && ids.length
      ? prisma.updateReaction.findMany({ where: { postId: { in: ids }, personId: viewer.personId }, select: { postId: true, type: true } })
      : Promise.resolve([] as { postId: string; type: string }[]),
  ]);

  const countsByPost = new Map<string, Record<string, number>>();
  for (const g of reactionGroups) {
    const counts = countsByPost.get(g.postId) ?? {};
    counts[g.type] = g._count._all;
    countsByPost.set(g.postId, counts);
  }
  const mine = new Map(myReactions.map((r) => [r.postId, r.type]));

  res.json({
    viewer: { canPost: viewer.personId !== null, canModerate: viewer.canModerate, personId: viewer.personId },
    items: page.map((p) => ({
      id: p.id,
      author: { personId: p.author.id, name: p.author.name, photoUrl: profilePhotoPath(p.author) },
      body: p.body,
      youtubeVideoId: p.youtubeVideoId,
      createdAt: p.createdAt,
      photos: p.photos.map((ph) => ({ id: ph.id, url: `/api/updates/photos/${ph.id}` })),
      reactionCounts: countsByPost.get(p.id) ?? {},
      myReaction: mine.get(p.id) ?? null,
      commentCount: p._count.comments,
      canDelete: viewer.canModerate || (viewer.personId !== null && p.author.id === viewer.personId),
    })),
    nextBefore: hasMore ? page[page.length - 1].createdAt.toISOString() : null,
  });
}));

const photoRefSchema = z.object({
  storageKey: z.string().min(1),
  mimeType: z.string().min(1),
  byteSize: z.number().int().positive(),
});

const createPostSchema = z.object({
  body: z.string().trim().max(MAX_UPDATE_BODY).default(''),
  youtubeUrl: z.string().trim().max(500).optional(),
  photos: z.array(photoRefSchema).max(MAX_PHOTOS_PER_UPDATE).default([]),
});

router.post('/', updatePostLimiter, requireCsrf, requireViewer, requirePerson, asyncHandler(async (req, res) => {
  const viewer = req.updatesViewer!;
  const personId = viewer.personId!;
  const parsed = createPostSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid post.' });
  }
  const d = parsed.data;

  let youtubeVideoId: string | null = null;
  if (d.youtubeUrl) {
    youtubeVideoId = parseYoutubeVideoId(d.youtubeUrl);
    if (!youtubeVideoId) return res.status(400).json({ error: 'That does not look like a YouTube link.', code: 'INVALID_YOUTUBE' });
  }
  if (!d.body && d.photos.length === 0 && !youtubeVideoId) {
    return res.status(400).json({ error: 'Write something, or add a photo or video.', code: 'EMPTY_POST' });
  }

  // Every photo must be one this person uploaded, and must really be in storage.
  if (d.photos.length > 0) {
    if (!isStorageConfigured()) {
      return res.status(503).json({ error: 'Photo uploads are not available right now.', code: 'STORAGE_UNAVAILABLE' });
    }
    for (const ph of d.photos) {
      if (!isStorageKeyForUpdatePhoto(ph.storageKey, personId)) return res.status(400).json({ error: 'Invalid photo reference.' });
      if (!PHOTO_MIME_TYPES.includes(ph.mimeType) || ph.byteSize > ATTACHMENT_MIME_LIMITS[ph.mimeType]) {
        return res.status(400).json({ error: 'Invalid photo.' });
      }
      const head = await headObject({ storageKey: ph.storageKey });
      if (!head || head.contentLength !== ph.byteSize || (head.contentType && head.contentType !== ph.mimeType)) {
        return res.status(400).json({ error: 'A photo upload could not be verified. Please try again.' });
      }
    }
  }

  const post = await prisma.updatePost.create({
    data: {
      authorPersonId: personId,
      body: d.body,
      youtubeVideoId,
      photos: {
        create: d.photos.map((ph, position) => ({
          storageKey: ph.storageKey,
          mimeType: ph.mimeType,
          byteSize: ph.byteSize,
          position,
        })),
      },
    },
    select: { id: true },
  });
  res.status(201).json({ id: post.id });
}));

router.delete('/:id', updatePostLimiter, requireCsrf, requireViewer, asyncHandler(async (req, res) => {
  const viewer = req.updatesViewer!;
  const post = await prisma.updatePost.findUnique({ where: { id: req.params.id } });
  if (!post || post.deletedAt) return res.status(404).json({ error: 'Post not found.' });
  const isAuthor = viewer.personId !== null && post.authorPersonId === viewer.personId;
  if (!isAuthor && !viewer.canModerate) return res.status(403).json({ error: 'You cannot delete this post.' });

  await prisma.updatePost.update({ where: { id: post.id }, data: { deletedAt: new Date(), ...deletedByFields(viewer) } });
  await recordAudit({
    actorId: viewer.userId,
    action: isAuthor ? 'UPDATE_POST_DELETED_BY_AUTHOR' : 'UPDATE_POST_REMOVED_BY_MODERATOR',
    targetType: 'UpdatePost',
    targetId: post.id,
    metadata: { authorPersonId: post.authorPersonId, byPersonId: viewer.personId },
  });
  res.json({ ok: true });
}));

// ----------------------------- Reactions -----------------------------------

const reactionSchema = z.object({ type: z.enum(REACTION_TYPES) });

async function visiblePost(id: string) {
  const post = await prisma.updatePost.findUnique({ where: { id }, select: { id: true, deletedAt: true } });
  return post && !post.deletedAt ? post : null;
}

router.put('/:id/reaction', updateReactionLimiter, requireCsrf, requireViewer, requirePerson, asyncHandler(async (req, res) => {
  const parsed = reactionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid reaction.' });
  if (!(await visiblePost(req.params.id))) return res.status(404).json({ error: 'Post not found.' });
  const personId = req.updatesViewer!.personId!;
  await prisma.updateReaction.upsert({
    where: { postId_personId: { postId: req.params.id, personId } },
    create: { postId: req.params.id, personId, type: parsed.data.type },
    update: { type: parsed.data.type },
  });
  res.json({ myReaction: parsed.data.type });
}));

router.delete('/:id/reaction', updateReactionLimiter, requireCsrf, requireViewer, requirePerson, asyncHandler(async (req, res) => {
  await prisma.updateReaction.deleteMany({ where: { postId: req.params.id, personId: req.updatesViewer!.personId! } });
  res.json({ myReaction: null });
}));

// ----------------------------- Comments (by post) --------------------------

router.get('/:id/comments', requireViewer, asyncHandler(async (req, res) => {
  const viewer = req.updatesViewer!;
  if (!(await visiblePost(req.params.id))) return res.status(404).json({ error: 'Post not found.' });
  const comments = await prisma.updateComment.findMany({
    where: { postId: req.params.id, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    take: 200,
    include: { author: { select: { id: true, name: true, photoStorageKey: true, photoUpdatedAt: true } } },
  });
  res.json({
    items: comments.map((c) => ({
      id: c.id,
      author: { personId: c.author.id, name: c.author.name, photoUrl: profilePhotoPath(c.author) },
      body: c.body,
      createdAt: c.createdAt,
      canDelete: viewer.canModerate || (viewer.personId !== null && c.author.id === viewer.personId),
    })),
  });
}));

const commentSchema = z.object({ body: z.string().trim().min(1).max(MAX_COMMENT_BODY) });

router.post('/:id/comments', updateCommentLimiter, requireCsrf, requireViewer, requirePerson, asyncHandler(async (req, res) => {
  const parsed = commentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Write a comment first.' });
  if (!(await visiblePost(req.params.id))) return res.status(404).json({ error: 'Post not found.' });
  const comment = await prisma.updateComment.create({
    data: { postId: req.params.id, authorPersonId: req.updatesViewer!.personId!, body: parsed.data.body },
    select: { id: true },
  });
  res.status(201).json({ id: comment.id });
}));

export default router;
