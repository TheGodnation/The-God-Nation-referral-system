import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { requireCsrf } from '../lib/csrf';
import { recordAudit } from '../lib/audit';
import { asyncHandler } from '../lib/asyncHandler';
import { attachmentUploadAuthorizeLimiter, attachmentDownloadLimiter } from '../lib/rateLimit';
import { isStorageConfigured, createUploadUrl, createDownloadUrl, headObject } from '../lib/storage';
import {
  PROFILE_PHOTO_MIME_LIMITS,
  isAllowedProfilePhotoMime,
  generateAppBannerStorageKey,
  isStorageKeyForAppBanner,
  generateGroupPhotoStorageKey,
  isStorageKeyForGroupPhoto,
} from '../lib/attachmentPolicy';
import { appBannerPath, groupPhotoPath } from '../lib/profilePhoto';

// The ministry's look in the member app, set by the admin only:
//  - the banner picture at the top of the Updates page (its Mission /
//    Vision / Purpose text is part of the editable site text),
//  - each group's picture and purpose / vision text.
// Pictures use the usual three steps (ask for an upload link → upload
// straight to storage → confirm, checked by the server) and are viewed by
// signed-in people through short redirects, never public links.

const router = Router();
const adminOnly = [requireAuth, requireRole('ADMIN')];

const authorizeSchema = z.object({ mimeType: z.string().min(1), byteSize: z.number().int().positive() });
const finalizeSchema = z.object({ storageKey: z.string().min(1), mimeType: z.string().min(1), byteSize: z.number().int().positive() });

function checkImage(mimeType: string, byteSize: number): { error: string; code: string } | null {
  if (!isAllowedProfilePhotoMime(mimeType)) return { error: 'Please choose a JPG, PNG or WebP picture.', code: 'UNSUPPORTED_TYPE' };
  if (byteSize > PROFILE_PHOTO_MIME_LIMITS[mimeType]) return { error: 'This picture is too large.', code: 'TOO_LARGE' };
  if (!isStorageConfigured()) return { error: 'Photo uploads are not available right now.', code: 'STORAGE_UNAVAILABLE' };
  return null;
}

async function verifyUpload(storageKey: string, mimeType: string, byteSize: number) {
  const head = await headObject({ storageKey });
  return Boolean(head && head.contentLength === byteSize && (!head.contentType || head.contentType === mimeType));
}

function requireSignedIn(req: Request, res: Response, next: NextFunction) {
  if (!req.member && !req.user) return res.status(401).json({ error: 'Authentication required.' });
  next();
}

// ------------------------------------------------------------ Updates banner

router.post('/admin/app-banner/authorize', ...adminOnly, attachmentUploadAuthorizeLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = authorizeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid photo.' });
  const problem = checkImage(parsed.data.mimeType, parsed.data.byteSize);
  if (problem) return res.status(problem.code === 'STORAGE_UNAVAILABLE' ? 503 : 400).json(problem);
  const storageKey = generateAppBannerStorageKey();
  const { url, expiresAt } = await createUploadUrl({ storageKey, mimeType: parsed.data.mimeType });
  res.json({ storageKey, uploadUrl: url, expiresAt });
}));

router.post('/admin/app-banner', ...adminOnly, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = finalizeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid photo.' });
  const d = parsed.data;
  if (!isStorageKeyForAppBanner(d.storageKey)) return res.status(400).json({ error: 'Invalid photo reference.' });
  const problem = checkImage(d.mimeType, d.byteSize);
  if (problem) return res.status(problem.code === 'STORAGE_UNAVAILABLE' ? 503 : 400).json(problem);
  if (!(await verifyUpload(d.storageKey, d.mimeType, d.byteSize))) {
    return res.status(400).json({ error: 'The photo upload could not be verified. Please try again.' });
  }
  const settings = await prisma.settings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', appBannerStorageKey: d.storageKey, appBannerUpdatedAt: new Date() },
    update: { appBannerStorageKey: d.storageKey, appBannerUpdatedAt: new Date() },
  });
  await recordAudit({ actorId: req.user!.id, actorEmail: req.user!.email, action: 'APP_BANNER_UPDATED', targetType: 'Settings', targetId: 'singleton' });
  res.json({ appBannerUrl: appBannerPath(settings) });
}));

router.delete('/admin/app-banner', ...adminOnly, requireCsrf, asyncHandler(async (req, res) => {
  await prisma.settings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton' },
    update: { appBannerStorageKey: null, appBannerUpdatedAt: new Date() },
  });
  await recordAudit({ actorId: req.user!.id, actorEmail: req.user!.email, action: 'APP_BANNER_REMOVED', targetType: 'Settings', targetId: 'singleton' });
  res.json({ appBannerUrl: null });
}));

// GET /api/app-banner — the banner picture, for signed-in people.
router.get('/app-banner', requireSignedIn, attachmentDownloadLimiter, asyncHandler(async (_req, res) => {
  const settings = await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { appBannerStorageKey: true } });
  if (!settings?.appBannerStorageKey || !isStorageConfigured()) return res.status(404).json({ error: 'No banner.' });
  const { url } = await createDownloadUrl({ storageKey: settings.appBannerStorageKey });
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.redirect(302, url);
}));

// ------------------------------------------------------------ Group details

async function findCommunity(req: Request, res: Response) {
  const community = await prisma.community.findUnique({ where: { id: req.params.communityId } });
  if (!community) {
    res.status(404).json({ error: 'Community not found.' });
    return null;
  }
  return community;
}

router.post('/admin/communities/:communityId/photo/authorize', ...adminOnly, attachmentUploadAuthorizeLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const community = await findCommunity(req, res);
  if (!community) return;
  const parsed = authorizeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid photo.' });
  const problem = checkImage(parsed.data.mimeType, parsed.data.byteSize);
  if (problem) return res.status(problem.code === 'STORAGE_UNAVAILABLE' ? 503 : 400).json(problem);
  const storageKey = generateGroupPhotoStorageKey(community.id);
  const { url, expiresAt } = await createUploadUrl({ storageKey, mimeType: parsed.data.mimeType });
  res.json({ storageKey, uploadUrl: url, expiresAt });
}));

router.post('/admin/communities/:communityId/photo', ...adminOnly, requireCsrf, asyncHandler(async (req, res) => {
  const community = await findCommunity(req, res);
  if (!community) return;
  const parsed = finalizeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid photo.' });
  const d = parsed.data;
  if (!isStorageKeyForGroupPhoto(d.storageKey, community.id)) return res.status(400).json({ error: 'Invalid photo reference.' });
  const problem = checkImage(d.mimeType, d.byteSize);
  if (problem) return res.status(problem.code === 'STORAGE_UNAVAILABLE' ? 503 : 400).json(problem);
  if (!(await verifyUpload(d.storageKey, d.mimeType, d.byteSize))) {
    return res.status(400).json({ error: 'The photo upload could not be verified. Please try again.' });
  }
  const updated = await prisma.community.update({
    where: { id: community.id },
    data: { photoStorageKey: d.storageKey, photoUpdatedAt: new Date() },
  });
  await recordAudit({ actorId: req.user!.id, actorEmail: req.user!.email, action: 'GROUP_PHOTO_UPDATED', targetType: 'Community', targetId: community.id });
  res.json({ photoUrl: groupPhotoPath(updated) });
}));

router.delete('/admin/communities/:communityId/photo', ...adminOnly, requireCsrf, asyncHandler(async (req, res) => {
  const community = await findCommunity(req, res);
  if (!community) return;
  await prisma.community.update({ where: { id: community.id }, data: { photoStorageKey: null, photoUpdatedAt: new Date() } });
  await recordAudit({ actorId: req.user!.id, actorEmail: req.user!.email, action: 'GROUP_PHOTO_REMOVED', targetType: 'Community', targetId: community.id });
  res.json({ photoUrl: null });
}));

const aboutSchema = z.object({
  aboutEn: z.string().trim().max(1500).optional(),
  aboutFr: z.string().trim().max(1500).optional(),
});

// PATCH /api/admin/communities/:communityId/about — the group's purpose /
// vision text (English and French). An empty value clears it.
router.patch('/admin/communities/:communityId/about', ...adminOnly, requireCsrf, asyncHandler(async (req, res) => {
  const community = await findCommunity(req, res);
  if (!community) return;
  const parsed = aboutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'The text is too long (1500 characters at most).' });
  const updated = await prisma.community.update({
    where: { id: community.id },
    data: {
      ...(parsed.data.aboutEn !== undefined ? { aboutEn: parsed.data.aboutEn || null } : {}),
      ...(parsed.data.aboutFr !== undefined ? { aboutFr: parsed.data.aboutFr || null } : {}),
    },
  });
  await recordAudit({ actorId: req.user!.id, actorEmail: req.user!.email, action: 'GROUP_ABOUT_UPDATED', targetType: 'Community', targetId: community.id });
  res.json({ aboutEn: updated.aboutEn, aboutFr: updated.aboutFr });
}));

// GET /api/admin/communities/:communityId/details — what the admin form shows.
router.get('/admin/communities/:communityId/details', ...adminOnly, asyncHandler(async (req, res) => {
  const community = await findCommunity(req, res);
  if (!community) return;
  res.json({ photoUrl: groupPhotoPath(community), aboutEn: community.aboutEn, aboutFr: community.aboutFr });
}));

// GET /api/group-photos/:communityId — a group's picture, for signed-in people.
router.get('/group-photos/:communityId', requireSignedIn, attachmentDownloadLimiter, asyncHandler(async (req, res) => {
  const community = await prisma.community.findUnique({ where: { id: req.params.communityId }, select: { photoStorageKey: true } });
  if (!community?.photoStorageKey || !isStorageConfigured()) return res.status(404).json({ error: 'No photo.' });
  const { url } = await createDownloadUrl({ storageKey: community.photoStorageKey });
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.redirect(302, url);
}));

export default router;
