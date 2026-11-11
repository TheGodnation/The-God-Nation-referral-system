import { Router, type Request } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../lib/auth';
import { requireMember } from '../lib/memberAuth';
import { requireCsrf } from '../lib/csrf';
import { attachmentUploadAuthorizeLimiter, leadershipMutationLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import { recordAudit } from '../lib/audit';
import { prisma } from '../lib/prisma';
import { profilePhotoPath } from '../lib/profilePhoto';
import { createUploadUrl, isStorageConfigured } from '../lib/storage';
import { MAX_ORIGINAL_FILENAME_LENGTH, MAX_PDF_PAGE_COUNT, MAX_THUMB_DATA_URL_LENGTH, THUMB_DATA_URL_PATTERN, isAllowedAttachmentMime, isValidOriginalFilename, maxBytesForMime } from '../lib/attachmentPolicy';
import { MAX_MESSAGE_CHARS } from '../lib/textLimits';
import { BroadcastError, generateStagingKey, sendCoordinatorMessage } from '../lib/leaderBroadcast';
import { DESK_FILTERS, DeskError, deskPersonIds, markContacted, peopleNeedingMe, requireDeskOwner, takeOver, type DeskFilter } from '../lib/coordinatorDesk';
import { isCentralAdminPerson } from '../lib/centralAdmin';

// "People who need me": the National Coordinator's own desk. Offered twice, with the same rules: in the admin dashboard
// and in the central admin's own member profile.

const querySchema = z.object({
  filter: z.enum(DESK_FILTERS as [DeskFilter, ...DeskFilter[]]).optional(),
  q: z.string().trim().max(80).optional(),
  communityId: z.string().min(1).max(64).optional(),
  language: z.enum(['en', 'fr']).optional(),
  page: z.coerce.number().int().min(1).max(1000).optional(),
});
const personSchema = z.object({ personId: z.string().min(1) });
const contactedSchema = z.object({
  personId: z.string().min(1),
  wellbeing: z.enum(['GOOD', 'NEEDS_ATTENTION', 'EMERGENCY', 'UNABLE_TO_REACH']).optional(),
  note: z.string().max(2000).nullable().optional(),
});
const attachmentSchema = z.object({
  storageKey: z.string().min(1),
  originalFilename: z.string().trim().min(1).max(MAX_ORIGINAL_FILENAME_LENGTH),
  mimeType: z.string().min(1),
  byteSize: z.number().int().positive(),
  thumb: z.string().max(MAX_THUMB_DATA_URL_LENGTH).regex(THUMB_DATA_URL_PATTERN).optional(),
  pageCount: z.number().int().min(1).max(MAX_PDF_PAGE_COUNT).optional(),
});
const messageSchema = z.object({
  personIds: z.array(z.string().min(1)).min(1).max(1000),
  body: z.string().max(MAX_MESSAGE_CHARS).optional(),
  attachments: z.array(attachmentSchema).max(10).optional(),
});
const authorizeSchema = z.object({
  originalFilename: z.string().trim().min(1).max(MAX_ORIGINAL_FILENAME_LENGTH),
  mimeType: z.string().min(1),
  byteSize: z.number().int().positive(),
});

function buildRouter(resolvePersonId: (req: Request) => Promise<string | null>) {
  const router = Router();
  const who = async (req: Request) => {
    const personId = await resolvePersonId(req);
    if (!personId) throw new DeskError('Your administrator account is not linked to a member profile yet.', 409);
    return personId;
  };

  router.get('/', asyncHandler(async (req, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid filter.' });
    const result = await peopleNeedingMe(await who(req), parsed.data);
    res.json({ ...result, items: result.items.map(({ photoStorageKey, photoUpdatedAt, ...p }) => ({ ...p, photoUrl: profilePhotoPath({ id: p.personId, photoStorageKey, photoUpdatedAt }) })) });
  }));

  // The assemblies and groups to filter by.
  router.get('/assemblies', asyncHandler(async (_req, res) => {
    const rows = await prisma.community.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 500 });
    res.json({ items: rows });
  }));

  // Everyone matching the filter (for "select all").
  router.get('/ids', asyncHandler(async (req, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid filter.' });
    res.json(await deskPersonIds(await who(req), parsed.data));
  }));

  router.post('/take-over', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const parsed = personSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'personId is required.' });
    res.json(await takeOver(await who(req), parsed.data.personId));
  }));

  router.post('/contacted', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const parsed = contactedSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request.' });
    res.status(201).json(await markContacted(await who(req), parsed.data.personId, { wellbeing: parsed.data.wellbeing, note: parsed.data.note }));
  }));

  // Photos and voice messages are uploaded once to a staging place; sending copies them into each private chat.
  router.post('/attachments/authorize', attachmentUploadAuthorizeLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const personId = await who(req);
    await requireDeskOwner(personId);
    const parsed = authorizeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid attachment request.' });
    const { originalFilename, mimeType, byteSize } = parsed.data;
    if (!isAllowedAttachmentMime(mimeType)) return res.status(400).json({ error: 'Unsupported attachment type.' });
    const maxBytes = maxBytesForMime(mimeType)!;
    if (byteSize > maxBytes) return res.status(400).json({ error: 'Attachment is too large.' });
    if (!isValidOriginalFilename(originalFilename)) return res.status(400).json({ error: 'Invalid attachment filename.' });
    if (!isStorageConfigured()) return res.status(503).json({ error: 'Attachments are not available right now.' });
    const storageKey = generateStagingKey(personId);
    const { url, expiresAt } = await createUploadUrl({ storageKey, mimeType });
    res.json({ storageKey, uploadUrl: url, expiresAt, maxBytes });
  }));

  // One message to the people chosen, as an ordinary private message from the National Coordinator.
  router.post('/message', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const parsed = messageSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Choose who to send this to, and write a message or add a photo or a voice message.' });
    const personId = await who(req);
    const admin = await requireDeskOwner(personId);
    const result = await sendCoordinatorMessage(personId, parsed.data);
    await recordAudit({ actorId: admin.id, actorEmail: admin.email, action: 'LEADER_BROADCAST_SENT', targetType: 'LeaderBroadcast', targetId: result.id, metadata: { via: 'needs-me', recipients: result.recipients, skipped: result.skipped } }).catch(() => {});
    res.status(201).json(result);
  }));

  router.use((err: unknown, _req: any, res: any, next: any) => {
    if (err instanceof DeskError || err instanceof BroadcastError) return res.status(err.status).json({ error: err.message });
    next(err);
  });
  return router;
}

export const adminNeedsMeRoutes = (() => {
  const router = Router();
  router.use(requireAuth, requireRole('ADMIN'));
  router.use(buildRouter(async (req) => req.user?.personId ?? null));
  return router;
})();

export const memberCentralNeedsMeRoutes = (() => {
  const router = Router();
  router.use(requireMember);
  router.use(
    asyncHandler(async (req, res, next) => {
      if (!(await isCentralAdminPerson(req.member!.personId))) return res.status(403).json({ error: 'Forbidden.' });
      next();
    }),
  );
  router.use(buildRouter(async (req) => req.member!.personId));
  return router;
})();
