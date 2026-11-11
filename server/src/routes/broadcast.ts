import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../lib/auth';
import { requireMember } from '../lib/memberAuth';
import { requireCsrf } from '../lib/csrf';
import { isCentralAdminPerson } from '../lib/centralAdmin';
import { attachmentUploadAuthorizeLimiter, leadershipMutationLimiter, privateTranslateLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import { recordAudit } from '../lib/audit';
import { prisma } from '../lib/prisma';
import { representedGeneration } from '../lib/representatives';
import { createUploadUrl, isStorageConfigured } from '../lib/storage';
import { MAX_ORIGINAL_FILENAME_LENGTH, MAX_PDF_PAGE_COUNT, MAX_THUMB_DATA_URL_LENGTH, THUMB_DATA_URL_PATTERN, isAllowedAttachmentMime, isValidOriginalFilename, maxBytesForMime } from '../lib/attachmentPolicy';
import { MAX_MESSAGE_CHARS } from '../lib/textLimits';
import { BroadcastError, broadcastLog, generateStagingKey, leaderIdsOfGeneration, peopleOf, requireLeaderPerson, sendBroadcast } from '../lib/leaderBroadcast';
import { previewTranslation } from '../lib/broadcastTranslation';

// "Message all my people" — a leader's door (/api/member/broadcast) and the log for the central admin and for
// representatives (limited to the leaders of their own generation).

const attachmentSchema = z.object({
  storageKey: z.string().min(1),
  originalFilename: z.string().trim().min(1).max(MAX_ORIGINAL_FILENAME_LENGTH),
  mimeType: z.string().min(1),
  byteSize: z.number().int().positive(),
  thumb: z.string().max(MAX_THUMB_DATA_URL_LENGTH).regex(THUMB_DATA_URL_PATTERN).optional(),
  pageCount: z.number().int().min(1).max(MAX_PDF_PAGE_COUNT).optional(),
});
const sendSchema = z.object({
  personIds: z.array(z.string().min(1)).max(1000).optional(),
  body: z.string().max(MAX_MESSAGE_CHARS).optional(),
  attachments: z.array(attachmentSchema).max(10).optional(),
  translation: z.object({ language: z.enum(['en', 'fr']), body: z.string().max(MAX_MESSAGE_CHARS) }).optional(),
});
const authorizeSchema = z.object({
  originalFilename: z.string().trim().min(1).max(MAX_ORIGINAL_FILENAME_LENGTH),
  mimeType: z.string().min(1),
  byteSize: z.number().int().positive(),
});

const onError = (err: unknown, _req: any, res: any, next: any) => {
  if (err instanceof BroadcastError) return res.status(err.status).json({ error: err.message });
  next(err);
};

export const memberBroadcastRoutes = (() => {
  const router = Router();
  router.use(requireMember);

  router.get('/people', asyncHandler(async (req, res) => {
    await requireLeaderPerson(req.member!.personId);
    res.json({ items: await peopleOf(req.member!.personId) });
  }));

  router.get('/mine', asyncHandler(async (req, res) => {
    await requireLeaderPerson(req.member!.personId);
    res.json({ items: await broadcastLog({ senderPersonIds: [req.member!.personId] }) });
  }));

  // Photos and voice messages are uploaded once to a staging place; sending copies them into each private chat.
  router.post('/attachments/authorize', attachmentUploadAuthorizeLimiter, requireCsrf, asyncHandler(async (req, res) => {
    await requireLeaderPerson(req.member!.personId);
    const parsed = authorizeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid attachment request.' });
    const { originalFilename, mimeType, byteSize } = parsed.data;
    if (!isAllowedAttachmentMime(mimeType)) return res.status(400).json({ error: 'Unsupported attachment type.' });
    const maxBytes = maxBytesForMime(mimeType)!;
    if (byteSize > maxBytes) return res.status(400).json({ error: 'Attachment is too large.' });
    if (!isValidOriginalFilename(originalFilename)) return res.status(400).json({ error: 'Invalid attachment filename.' });
    if (!isStorageConfigured()) return res.status(503).json({ error: 'Attachments are not available right now.' });
    const storageKey = generateStagingKey(req.member!.personId);
    const { url, expiresAt } = await createUploadUrl({ storageKey, mimeType });
    res.json({ storageKey, uploadUrl: url, expiresAt, maxBytes });
  }));

  // The preview step: the message translated once, to read and correct before sending to people of both languages.
  router.post('/translate-preview', privateTranslateLimiter, requireCsrf, asyncHandler(async (req, res) => {
    await requireLeaderPerson(req.member!.personId);
    const text = typeof req.body?.text === 'string' ? req.body.text : '';
    res.json(await previewTranslation(text));
  }));

  router.post('/', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Write a message or add a photo or a voice message.' });
    const result = await sendBroadcast(req.member!.personId, parsed.data);
    const user = await prisma.user.findUnique({ where: { personId: req.member!.personId }, select: { id: true, email: true } });
    await recordAudit({ actorId: user?.id ?? null, actorEmail: user?.email ?? null, action: 'LEADER_BROADCAST_SENT', targetType: 'LeaderBroadcast', targetId: result.id, metadata: { actorPersonId: req.member!.personId, recipients: result.recipients, skipped: result.skipped } });
    res.status(201).json(result);
  }));

  router.use(onError);
  return router;
})();

export const adminBroadcastLogRoutes = (() => {
  const router = Router();
  router.use(requireAuth, requireRole('ADMIN'));
  router.get('/', asyncHandler(async (_req, res) => {
    res.json({ items: await broadcastLog() });
  }));
  return router;
})();

export const memberCentralBroadcastLogRoutes = (() => {
  const router = Router();
  router.use(requireMember);
  router.get('/', asyncHandler(async (req, res) => {
    if (!(await isCentralAdminPerson(req.member!.personId))) return res.status(403).json({ error: 'Forbidden.' });
    res.json({ items: await broadcastLog() });
  }));
  return router;
})();

export const memberRepBroadcastLogRoutes = (() => {
  const router = Router();
  router.use(requireMember);
  router.get('/', asyncHandler(async (req, res) => {
    const generation = await representedGeneration(req.member!.personId);
    if (generation === null) return res.status(403).json({ error: 'Only the representative of a generation can use this.' });
    res.json({ items: await broadcastLog({ senderPersonIds: await leaderIdsOfGeneration(generation) }) });
  }));
  return router;
})();
