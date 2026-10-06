import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireMember } from '../lib/memberAuth';
import { requireCsrf } from '../lib/csrf';
import { recordAudit } from '../lib/audit';
import { asyncHandler } from '../lib/asyncHandler';
import { attachmentUploadAuthorizeLimiter, memberProfileUpdateLimiter } from '../lib/rateLimit';
import { isStorageConfigured, createUploadUrl, createDownloadUrl, headObject } from '../lib/storage';
import {
  PROFILE_PHOTO_MIME_LIMITS,
  isAllowedProfilePhotoMime,
  generateProfilePhotoStorageKey,
  isStorageKeyForProfilePhoto,
  generateCoverPhotoStorageKey,
  isStorageKeyForCoverPhoto,
} from '../lib/attachmentPolicy';
import { profilePhotoPath, coverPhotoPath } from '../lib/profilePhoto';

// ---------------------------------------------------------------------------
// Profile pictures. Same three-step direct-to-storage upload used for chat
// attachments and Headquarters post media:
//   1. POST /api/member/me/photo/authorize -> short-lived upload URL
//   2. the browser uploads the image straight to storage
//   3. POST /api/member/me/photo -> server checks the upload really landed
//      with the declared type/size, then saves it as the member's picture
// Pictures are viewed through GET /api/people/:personId/photo, which only
// signed-in people (members, leaders, admins) can use — never a public URL.
// ---------------------------------------------------------------------------

const router = Router();

const authorizeSchema = z.object({
  mimeType: z.string().min(1),
  byteSize: z.number().int().positive(),
});

router.post(
  '/member/me/photo/authorize',
  attachmentUploadAuthorizeLimiter,
  requireCsrf,
  requireMember,
  asyncHandler(async (req, res) => {
    const parsed = authorizeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid photo.' });
    const { mimeType, byteSize } = parsed.data;

    if (!isAllowedProfilePhotoMime(mimeType)) {
      return res.status(400).json({ error: 'Please choose a JPG, PNG or WebP picture.', code: 'UNSUPPORTED_TYPE' });
    }
    const maxBytes = PROFILE_PHOTO_MIME_LIMITS[mimeType];
    if (byteSize > maxBytes) {
      return res.status(400).json({ error: 'This picture is too large.', code: 'TOO_LARGE' });
    }
    if (!isStorageConfigured()) {
      return res.status(503).json({ error: 'Photo uploads are not available right now.', code: 'STORAGE_UNAVAILABLE' });
    }

    const storageKey = generateProfilePhotoStorageKey(req.member!.personId);
    const { url, expiresAt } = await createUploadUrl({ storageKey, mimeType });
    res.json({ storageKey, uploadUrl: url, expiresAt, maxBytes });
  }),
);

const finalizeSchema = z.object({
  storageKey: z.string().min(1),
  mimeType: z.string().min(1),
  byteSize: z.number().int().positive(),
});

router.post(
  '/member/me/photo',
  memberProfileUpdateLimiter,
  requireCsrf,
  requireMember,
  asyncHandler(async (req, res) => {
    const parsed = finalizeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid photo.' });
    const d = parsed.data;
    const personId = req.member!.personId;

    // The key must be one we issued for THIS member — never someone else's.
    if (!isStorageKeyForProfilePhoto(d.storageKey, personId)) {
      return res.status(400).json({ error: 'Invalid photo reference.' });
    }
    if (!isAllowedProfilePhotoMime(d.mimeType) || d.byteSize > PROFILE_PHOTO_MIME_LIMITS[d.mimeType]) {
      return res.status(400).json({ error: 'Invalid photo.' });
    }
    if (!isStorageConfigured()) {
      return res.status(503).json({ error: 'Photo uploads are not available right now.', code: 'STORAGE_UNAVAILABLE' });
    }
    const head = await headObject({ storageKey: d.storageKey });
    if (!head || head.contentLength !== d.byteSize || (head.contentType && head.contentType !== d.mimeType)) {
      return res.status(400).json({ error: 'The photo upload could not be verified. Please try again.' });
    }

    const person = await prisma.person.update({
      where: { id: personId },
      data: { photoStorageKey: d.storageKey, photoUpdatedAt: new Date() },
      select: { id: true, photoStorageKey: true, photoUpdatedAt: true },
    });

    await recordAudit({ action: 'PROFILE_PHOTO_UPDATED', targetType: 'Person', targetId: personId });
    res.json({ photoUrl: profilePhotoPath(person) });
  }),
);

router.delete(
  '/member/me/photo',
  memberProfileUpdateLimiter,
  requireCsrf,
  requireMember,
  asyncHandler(async (req, res) => {
    const personId = req.member!.personId;
    await prisma.person.update({
      where: { id: personId },
      data: { photoStorageKey: null, photoUpdatedAt: new Date() },
    });
    await recordAudit({ action: 'PROFILE_PHOTO_REMOVED', targetType: 'Person', targetId: personId });
    res.json({ photoUrl: null });
  }),
);

// GET /api/people/:personId/photo — sends the browser to a short-lived
// signed link for the picture. Any signed-in member, leader or admin may
// view profile pictures (they are shown next to names in the community);
// anonymous visitors may not.
router.get(
  '/people/:personId/photo',
  asyncHandler(async (req, res) => {
    if (!req.member && !req.user) return res.status(401).json({ error: 'Authentication required.' });

    const person = await prisma.person.findUnique({
      where: { id: req.params.personId },
      select: { photoStorageKey: true },
    });
    if (!person?.photoStorageKey) return res.status(404).json({ error: 'No photo.' });
    if (!isStorageConfigured()) return res.status(404).json({ error: 'No photo.' });

    const { url } = await createDownloadUrl({ storageKey: person.photoStorageKey });
    // The signed link lasts 5 minutes; let the browser reuse this redirect
    // for 4 of them so a page full of pictures doesn't re-ask every time.
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.redirect(302, url);
  }),
);

// ---------------------------------------------------------------------------
// Cover pictures (the wide picture at the top of a member's wall). Exactly
// the same three steps and rules as profile pictures above.
// ---------------------------------------------------------------------------

router.post(
  '/member/me/cover/authorize',
  attachmentUploadAuthorizeLimiter,
  requireCsrf,
  requireMember,
  asyncHandler(async (req, res) => {
    const parsed = authorizeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid photo.' });
    const { mimeType, byteSize } = parsed.data;

    if (!isAllowedProfilePhotoMime(mimeType)) {
      return res.status(400).json({ error: 'Please choose a JPG, PNG or WebP picture.', code: 'UNSUPPORTED_TYPE' });
    }
    const maxBytes = PROFILE_PHOTO_MIME_LIMITS[mimeType];
    if (byteSize > maxBytes) {
      return res.status(400).json({ error: 'This picture is too large.', code: 'TOO_LARGE' });
    }
    if (!isStorageConfigured()) {
      return res.status(503).json({ error: 'Photo uploads are not available right now.', code: 'STORAGE_UNAVAILABLE' });
    }

    const storageKey = generateCoverPhotoStorageKey(req.member!.personId);
    const { url, expiresAt } = await createUploadUrl({ storageKey, mimeType });
    res.json({ storageKey, uploadUrl: url, expiresAt, maxBytes });
  }),
);

router.post(
  '/member/me/cover',
  memberProfileUpdateLimiter,
  requireCsrf,
  requireMember,
  asyncHandler(async (req, res) => {
    const parsed = finalizeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid photo.' });
    const d = parsed.data;
    const personId = req.member!.personId;

    if (!isStorageKeyForCoverPhoto(d.storageKey, personId)) {
      return res.status(400).json({ error: 'Invalid photo reference.' });
    }
    if (!isAllowedProfilePhotoMime(d.mimeType) || d.byteSize > PROFILE_PHOTO_MIME_LIMITS[d.mimeType]) {
      return res.status(400).json({ error: 'Invalid photo.' });
    }
    if (!isStorageConfigured()) {
      return res.status(503).json({ error: 'Photo uploads are not available right now.', code: 'STORAGE_UNAVAILABLE' });
    }
    const head = await headObject({ storageKey: d.storageKey });
    if (!head || head.contentLength !== d.byteSize || (head.contentType && head.contentType !== d.mimeType)) {
      return res.status(400).json({ error: 'The photo upload could not be verified. Please try again.' });
    }

    const person = await prisma.person.update({
      where: { id: personId },
      data: { coverStorageKey: d.storageKey, coverUpdatedAt: new Date() },
      select: { id: true, coverStorageKey: true, coverUpdatedAt: true },
    });

    await recordAudit({ action: 'COVER_PHOTO_UPDATED', targetType: 'Person', targetId: personId });
    res.json({ coverUrl: coverPhotoPath(person) });
  }),
);

router.delete(
  '/member/me/cover',
  memberProfileUpdateLimiter,
  requireCsrf,
  requireMember,
  asyncHandler(async (req, res) => {
    const personId = req.member!.personId;
    await prisma.person.update({
      where: { id: personId },
      data: { coverStorageKey: null, coverUpdatedAt: new Date() },
    });
    await recordAudit({ action: 'COVER_PHOTO_REMOVED', targetType: 'Person', targetId: personId });
    res.json({ coverUrl: null });
  }),
);

router.get(
  '/people/:personId/cover',
  asyncHandler(async (req, res) => {
    if (!req.member && !req.user) return res.status(401).json({ error: 'Authentication required.' });

    const person = await prisma.person.findUnique({
      where: { id: req.params.personId },
      select: { coverStorageKey: true },
    });
    if (!person?.coverStorageKey) return res.status(404).json({ error: 'No photo.' });
    if (!isStorageConfigured()) return res.status(404).json({ error: 'No photo.' });

    const { url } = await createDownloadUrl({ storageKey: person.coverStorageKey });
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.redirect(302, url);
  }),
);

export default router;
