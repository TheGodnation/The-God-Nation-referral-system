import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../lib/asyncHandler';
import { requireCsrf } from '../lib/csrf';
import { recordAudit } from '../lib/audit';
import { MAX_POST_CHARS } from '../lib/textLimits';
import { headquartersPostMutationLimiter, attachmentUploadAuthorizeLimiter } from '../lib/rateLimit';
import { validateCommunityTargetReferences, resolveHeadquartersPostAudiencePersonIds } from '../lib/headquartersPosts';
import { notifyHeadquartersPostPublished } from '../lib/notifications';
import {
  isAllowedAttachmentMime,
  maxBytesForMime,
  isValidOriginalFilename,
  isStorageKeyForHeadquartersPostMedia,
  generateHeadquartersPostMediaStorageKey,
  mediaKindForMime,
  MAX_ORIGINAL_FILENAME_LENGTH,
  MAX_HEADQUARTERS_POST_MEDIA,
} from '../lib/attachmentPolicy';
import { isStorageConfigured, createUploadUrl, headObject } from '../lib/storage';
import { resolveSocialLink, embedFor, findFirstUrl } from '../lib/socialEmbed';

// ---------------------------------------------------------------------------
// /api/share-into-app — forwarding a post from WhatsApp, TikTok, Facebook or
// Instagram (the phone's Share menu → this app) into the Updates feed as an
// official Headquarters post.
//
// Who can share:
//  - the Central Admin, signed in either to the admin account OR to their
//    own member profile on the phone (the profile linked to the admin
//    account — see lib/centralAdmin.ts);
//  - later, a Leader whose member profile the Central Admin has switched on
//    (Person.canShareIntoApp), and only into the groups they lead.
// Everyone else gets a polite "not for you" from GET /status, and every
// other route here refuses them. The post always records the real person
// who shared it (createdByUserId) even when it shows an official name.
// ---------------------------------------------------------------------------

interface Sharer {
  userId: string;
  email: string;
  personId: string | null;
  isAdmin: boolean;
  /** For a Leader: the only groups they may post into. Admin: null = any. */
  allowedCommunityIds: string[] | null;
}

declare global {
  namespace Express {
    interface Request {
      sharer?: Sharer;
    }
  }
}

export async function resolveSharer(req: Request): Promise<Sharer | null> {
  // 1. Signed in to the admin account itself.
  if (req.user?.role === 'ADMIN') {
    return { userId: req.user.id, email: req.user.email, personId: req.user.personId, isAdmin: true, allowedCommunityIds: null };
  }

  // 2. Signed in as a member (or as a Leader account): find the account
  //    linked to that member profile.
  const personId = req.member?.personId ?? (req.user?.role === 'LEADER' ? req.user.personId : null);
  if (!personId) return null;

  const user = await prisma.user.findUnique({
    where: { personId },
    select: { id: true, email: true, role: true, active: true },
  });
  if (!user || !user.active) return null;

  if (user.role === 'ADMIN') {
    return { userId: user.id, email: user.email, personId, isAdmin: true, allowedCommunityIds: null };
  }

  if (user.role === 'LEADER') {
    const person = await prisma.person.findUnique({ where: { id: personId }, select: { canShareIntoApp: true } });
    if (!person?.canShareIntoApp) return null;
    const assignments = await prisma.roleAssignment.findMany({
      where: { personId, status: 'ACTIVE', communityId: { not: null } },
      select: { communityId: true },
    });
    const ids = [...new Set(assignments.map((a) => a.communityId!))];
    return { userId: user.id, email: user.email, personId, isAdmin: false, allowedCommunityIds: ids };
  }

  return null;
}

async function requireSharer(req: Request, res: Response, next: NextFunction) {
  try {
    const sharer = await resolveSharer(req);
    if (!sharer) return res.status(403).json({ error: 'Only leaders can post this way.', code: 'NOT_A_SHARER' });
    req.sharer = sharer;
    next();
  } catch (err) {
    next(err);
  }
}

const router = Router();

// GET /api/share-into-app/status — never refuses: tells the Share screen
// whether to show the form or the "only leaders" note, and lists the groups
// this person can post into.
router.get('/status', asyncHandler(async (req, res) => {
  const sharer = await resolveSharer(req);
  if (!sharer) return res.json({ canShare: false });

  const communities = await prisma.community.findMany({
    where: { active: true, ...(sharer.allowedCommunityIds ? { id: { in: sharer.allowedCommunityIds } } : {}) },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
    take: 500,
  });

  res.json({
    canShare: true,
    isAdmin: sharer.isAdmin,
    canPostNetworkWide: sharer.isAdmin,
    canPostAsSelf: Boolean(sharer.personId),
    voices: sharer.isAdmin ? ['COMMUNICATION_DEPARTMENT', 'CENTRAL_AUTHORITY', 'SELF'] : ['COMMUNICATION_DEPARTMENT', 'SELF'],
    communities,
  });
}));

router.use(requireSharer);

// POST /api/share-into-app/link-preview — "will this show as a player?"
router.post('/link-preview', headquartersPostMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = z.object({ text: z.string().max(MAX_POST_CHARS + 2000) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid link.' });
  const raw = findFirstUrl(parsed.data.text) ?? parsed.data.text.trim();
  const link = raw ? await resolveSocialLink(raw) : null;
  if (!link) return res.json({ link: null });
  const embed = embedFor(link.provider, link.url);
  res.json({ link: embed, playable: Boolean(embed?.src) });
}));

const createSchema = z.object({
  title: z.string().trim().max(300).optional().default(''),
  body: z.string().trim().max(MAX_POST_CHARS).optional().default(''),
  link: z.string().trim().max(2000).optional().nullable(),
  voice: z.enum(['COMMUNICATION_DEPARTMENT', 'CENTRAL_AUTHORITY', 'SELF']).default('COMMUNICATION_DEPARTMENT'),
  networkWide: z.boolean().default(false),
  communityIds: z.array(z.string().min(1)).max(50).default([]),
});

// POST /api/share-into-app/posts — makes the post (not yet visible). The
// Share screen then uploads any shared photos/videos/voice notes, and
// finally calls /publish.
router.post('/posts', headquartersPostMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid post.' });
  }
  const d = parsed.data;
  const sharer = req.sharer!;

  // Audience
  if (d.networkWide && !sharer.isAdmin) {
    return res.status(403).json({ error: 'You can only post into the groups you lead.' });
  }
  const communityIds = d.networkWide ? [] : [...new Set(d.communityIds)];
  if (!d.networkWide && communityIds.length === 0) {
    return res.status(400).json({ error: 'Choose who will see this: everyone, or at least one group.' });
  }
  if (communityIds.length > 0) {
    if (sharer.allowedCommunityIds && communityIds.some((id) => !sharer.allowedCommunityIds!.includes(id))) {
      return res.status(403).json({ error: 'You can only post into the groups you lead.' });
    }
    if (!(await validateCommunityTargetReferences(communityIds))) {
      return res.status(400).json({ error: 'One or more groups could not be found.' });
    }
  }

  // Name shown
  if (d.voice === 'CENTRAL_AUTHORITY' && !sharer.isAdmin) {
    return res.status(403).json({ error: 'Only the Central Admin can post as Headquarters.' });
  }
  if (d.voice === 'SELF' && !sharer.personId) {
    return res.status(400).json({ error: 'Link your account to a Member profile first before posting as yourself.' });
  }

  // Link → player
  let linkUrl: string | null = null;
  let linkProvider: 'YOUTUBE' | 'TIKTOK' | 'INSTAGRAM' | 'FACEBOOK' | 'OTHER' | null = null;
  const rawLink = d.link || findFirstUrl(d.body);
  if (rawLink) {
    const resolved = await resolveSocialLink(rawLink);
    if (resolved) {
      linkUrl = resolved.url;
      linkProvider = resolved.provider;
    }
  }

  if (!d.title && !d.body && !linkUrl) {
    return res.status(400).json({ error: 'There is nothing to post yet.' });
  }

  const created = await prisma.headquartersPost.create({
    data: {
      titleEn: d.title,
      bodyEn: d.body,
      networkWide: d.networkWide,
      createdByUserId: sharer.userId,
      authorPersonId: d.voice === 'SELF' ? sharer.personId : null,
      voice: d.voice === 'COMMUNICATION_DEPARTMENT' ? 'COMMUNICATION_DEPARTMENT' : 'CENTRAL_AUTHORITY',
      linkUrl,
      linkProvider,
      targets: communityIds.length > 0 ? { create: communityIds.map((communityId) => ({ communityId })) } : undefined,
    },
  });

  await recordAudit({
    actorId: sharer.userId,
    actorEmail: sharer.email,
    action: 'HEADQUARTERS_POST_CREATED',
    targetType: 'HeadquartersPost',
    targetId: created.id,
    metadata: { via: 'share-into-app', voice: d.voice, linkProvider },
  });

  res.status(201).json({ id: created.id, link: embedFor(linkProvider, linkUrl) });
}));

/** A draft this sharer made, still open for adding media / publishing. */
async function ownDraft(req: Request, res: Response) {
  const post = await prisma.headquartersPost.findUnique({
    where: { id: req.params.id },
    include: { targets: { select: { communityId: true } } },
  });
  if (!post || post.createdByUserId !== req.sharer!.userId) {
    res.status(404).json({ error: 'Post not found.' });
    return null;
  }
  if (post.publishedAt || post.archivedAt) {
    res.status(409).json({ error: 'This post has already been published.' });
    return null;
  }
  return post;
}

const mediaSchema = z.object({
  originalFilename: z.string().trim().min(1).max(MAX_ORIGINAL_FILENAME_LENGTH),
  mimeType: z.string().min(1),
  byteSize: z.number().int().positive(),
});

function checkMedia(d: { originalFilename: string; mimeType: string; byteSize: number }): string | null {
  if (!isAllowedAttachmentMime(d.mimeType)) return 'This kind of file cannot be posted.';
  if (d.byteSize > maxBytesForMime(d.mimeType)!) return 'This file is too large.';
  if (!isValidOriginalFilename(d.originalFilename)) return 'Invalid file name.';
  return null;
}

// POST /api/share-into-app/posts/:id/media/authorize — same direct-to-
// storage upload as the admin Headquarters Posts screen.
router.post('/posts/:id/media/authorize', attachmentUploadAuthorizeLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const post = await ownDraft(req, res);
  if (!post) return;
  const count = await prisma.headquartersPostMedia.count({ where: { headquartersPostId: post.id } });
  if (count >= MAX_HEADQUARTERS_POST_MEDIA) {
    return res.status(409).json({ error: `A post can have at most ${MAX_HEADQUARTERS_POST_MEDIA} files.` });
  }
  const parsed = mediaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid file.' });
  const problem = checkMedia(parsed.data);
  if (problem) return res.status(400).json({ error: problem });
  if (!isStorageConfigured()) return res.status(503).json({ error: 'File uploads are not available right now.' });

  const storageKey = generateHeadquartersPostMediaStorageKey(post.id);
  const { url, expiresAt } = await createUploadUrl({ storageKey, mimeType: parsed.data.mimeType });
  res.json({ storageKey, uploadUrl: url, expiresAt });
}));

// POST /api/share-into-app/posts/:id/media — register an uploaded file.
router.post('/posts/:id/media', headquartersPostMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const post = await ownDraft(req, res);
  if (!post) return;
  const parsed = mediaSchema.extend({ storageKey: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid file.' });
  const d = parsed.data;
  if (!isStorageKeyForHeadquartersPostMedia(d.storageKey, post.id)) {
    return res.status(400).json({ error: 'Invalid file reference.' });
  }
  const problem = checkMedia(d);
  if (problem) return res.status(400).json({ error: problem });
  const mediaType = mediaKindForMime(d.mimeType);
  if (!mediaType) return res.status(400).json({ error: 'This kind of file cannot be posted.' });
  if (!isStorageConfigured()) return res.status(503).json({ error: 'File uploads are not available right now.' });

  const count = await prisma.headquartersPostMedia.count({ where: { headquartersPostId: post.id } });
  if (count >= MAX_HEADQUARTERS_POST_MEDIA) {
    return res.status(409).json({ error: `A post can have at most ${MAX_HEADQUARTERS_POST_MEDIA} files.` });
  }
  const head = await headObject({ storageKey: d.storageKey });
  if (!head || head.contentLength !== d.byteSize || (head.contentType && head.contentType !== d.mimeType)) {
    return res.status(400).json({ error: 'The upload could not be checked. Please try again.' });
  }

  const media = await prisma.headquartersPostMedia.create({
    data: {
      headquartersPostId: post.id,
      position: count,
      storageKey: d.storageKey,
      originalFilename: d.originalFilename,
      mimeType: d.mimeType,
      byteSize: d.byteSize,
      mediaType,
    },
    select: { id: true, mediaType: true },
  });
  res.status(201).json(media);
}));

// POST /api/share-into-app/posts/:id/publish — now everyone in the chosen
// audience sees it, and gets the usual notification.
router.post('/posts/:id/publish', headquartersPostMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const post = await ownDraft(req, res);
  if (!post) return;
  const mediaCount = await prisma.headquartersPostMedia.count({ where: { headquartersPostId: post.id } });
  if (!post.titleEn && !post.bodyEn && !post.linkUrl && mediaCount === 0) {
    return res.status(400).json({ error: 'There is nothing to post yet.' });
  }

  const result = await prisma.headquartersPost.updateMany({
    where: { id: post.id, publishedAt: null, archivedAt: null },
    data: { publishedAt: new Date() },
  });
  if (result.count !== 1) return res.status(409).json({ error: 'This post has already been published.' });

  await recordAudit({
    actorId: req.sharer!.userId,
    actorEmail: req.sharer!.email,
    action: 'HEADQUARTERS_POST_PUBLISHED',
    targetType: 'HeadquartersPost',
    targetId: post.id,
    metadata: { via: 'share-into-app' },
  });

  const notifyTitle = post.titleEn || post.bodyEn.split('\n')[0]?.slice(0, 120) || 'New post';
  const recipients = await resolveHeadquartersPostAudiencePersonIds(post);
  await notifyHeadquartersPostPublished({ id: post.id, titleEn: notifyTitle, titleFr: null }, recipients);

  res.json({ id: post.id, published: true });
}));

// PATCH /api/share-into-app/sharers/:personId — Central Admin only: switch
// forwarding on or off for one Leader (for later, when leaders are assigned).
router.patch('/sharers/:personId', headquartersPostMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  if (!req.sharer!.isAdmin) return res.status(403).json({ error: 'Only the Central Admin can change this.' });
  const parsed = z.object({ allowed: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request.' });
  const person = await prisma.person.findUnique({ where: { id: req.params.personId }, select: { id: true } });
  if (!person) return res.status(404).json({ error: 'Person not found.' });
  await prisma.person.update({ where: { id: person.id }, data: { canShareIntoApp: parsed.data.allowed } });
  await recordAudit({
    actorId: req.sharer!.userId,
    actorEmail: req.sharer!.email,
    action: parsed.data.allowed ? 'SHARE_INTO_APP_ALLOWED' : 'SHARE_INTO_APP_REMOVED',
    targetType: 'Person',
    targetId: person.id,
  });
  res.json({ personId: person.id, canShareIntoApp: parsed.data.allowed });
}));

export default router;
