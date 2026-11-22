import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { requireMember } from '../lib/memberAuth';
import { requireCsrf } from '../lib/csrf';
import { isCentralAdminPerson } from '../lib/centralAdmin';
import { leadershipMutationLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import { recordAudit } from '../lib/audit';
import { ShareError, isSharedKind, moreShared, publicItem, sharedPhotos, shareByLink, shareState, stopSharing } from '../lib/sharedPosts';
import { publishToWebsite, takeOffWebsite, websiteState } from '../lib/sharedArticles';
import { getObjectStream, isStorageConfigured } from '../lib/storage';
import { cardJpeg, pageJpeg, MAX_INPUT_BYTES } from '../lib/photoCard';

// Posts and announcements shared by link. Anyone can read a shared one (GET /api/shared/:kind/:id); only the central admin can
// open or close a link, from the admin dashboard or from their own member profile.

type Actor = { id: string; email: string };
const onError = (err: unknown, _req: Request, res: any, next: any) => {
  if (err instanceof ShareError) return res.status(err.status).json({ error: err.message, code: err.code });
  next(err);
};

export const publicSharedRoutes = (() => {
  const router = Router();
  router.get('/:kind/:id', asyncHandler(async (req, res) => {
    const { kind, id } = req.params;
    if (!isSharedKind(kind)) return res.status(404).json({ error: 'Not available.' });
    const item = await publicItem(kind, id);
    if (!item) return res.status(404).json({ error: 'This link is not available.' });
    const photos = await sharedPhotos(kind, id);
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ ...item, photos: photos.map((_, i) => ({ url: `/api/shared/${kind}/${id}/photo/${i}` })), more: await moreShared({ kind, id }) });
  }));

  // The pictures of a shared post, readable by anyone with the link while the link is open (and for no other file).
  // The card picture is cut to 1200x630 and kept small; the page pictures are scaled to fit a phone.
  const made = new Map<string, Buffer>();
  const remember = (key: string, bytes: Buffer) => {
    if (made.size >= 40) made.delete(made.keys().next().value as string);
    made.set(key, bytes);
  };
  async function sendPicture(req: Request, res: any, variant: 'card' | 'photo') {
    const { kind, id } = req.params;
    const n = variant === 'card' ? 0 : Number(req.params.n);
    if (!isSharedKind(kind) || !Number.isInteger(n) || n < 0 || !isStorageConfigured()) return res.status(404).json({ error: 'Not available.' });
    const photo = (await sharedPhotos(kind, id))[n];
    if (!photo || photo.byteSize > MAX_INPUT_BYTES) return res.status(404).json({ error: 'Not available.' });
    const cacheKey = `${variant}:${photo.storageKey}`;
    let bytes = made.get(cacheKey) ?? null;
    if (!bytes) {
      const object = await getObjectStream({ storageKey: photo.storageKey });
      if (!object) return res.status(404).json({ error: 'Not available.' });
      const chunks: Buffer[] = [];
      for await (const chunk of object.body as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
      const original = Buffer.concat(chunks);
      bytes = variant === 'card' ? await cardJpeg(original) : await pageJpeg(original);
      // If the picture cannot be resized the original is sent (the card then uses it only when it is small: see cardImagePath).
      if (!bytes) {
        res.set({ 'Content-Type': photo.mimeType, 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
        return res.send(original);
      }
      remember(cacheKey, bytes);
    }
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Content-Length': String(bytes.length) });
    res.send(bytes);
  }
  router.get('/:kind/:id/card.jpg', asyncHandler((req, res) => sendPicture(req, res, 'card')));
  router.get('/:kind/:id/photo/:n', asyncHandler((req, res) => sendPicture(req, res, 'photo')));
  return router;
})();

function buildAdminRouter(resolveActor: (req: Request) => Promise<Actor | null>) {
  const router = Router();
  const parse = (req: Request, res: any) => {
    const { kind, id } = req.params;
    if (!isSharedKind(kind)) {
      res.status(404).json({ error: 'Not found.' });
      return null;
    }
    return { kind, id };
  };
  router.get('/:kind/:id', asyncHandler(async (req, res) => {
    const k = parse(req, res);
    if (!k) return;
    res.json(await shareState(k.kind, k.id));
  }));
  router.post('/:kind/:id/share', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const k = parse(req, res);
    if (!k) return;
    const actor = await resolveActor(req);
    if (!actor) return res.status(403).json({ error: 'Forbidden.' });
    const result = await shareByLink(k.kind, k.id);
    await recordAudit({ actorId: actor.id, actorEmail: actor.email, action: 'POST_SHARED_BY_LINK', targetType: k.kind === 'post' ? 'HeadquartersPost' : k.kind === 'update' ? 'UpdatePost' : 'Announcement', targetId: k.id });
    res.json(result);
  }));
  router.delete('/:kind/:id/share', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const k = parse(req, res);
    if (!k) return;
    const actor = await resolveActor(req);
    if (!actor) return res.status(403).json({ error: 'Forbidden.' });
    const result = await stopSharing(k.kind, k.id);
    await recordAudit({ actorId: actor.id, actorEmail: actor.email, action: 'POST_SHARING_STOPPED', targetType: k.kind === 'post' ? 'HeadquartersPost' : k.kind === 'update' ? 'UpdatePost' : 'Announcement', targetId: k.id });
    res.json(result);
  }));
  // Also publish this post on the website (a Knowledge Centre article that Google can list).
  router.get('/:kind/:id/website', asyncHandler(async (req, res) => {
    const k = parse(req, res);
    if (!k) return;
    res.json(await websiteState(k.kind, k.id));
  }));
  router.post('/:kind/:id/website', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const k = parse(req, res);
    if (!k) return;
    const actor = await resolveActor(req);
    if (!actor) return res.status(403).json({ error: 'Forbidden.' });
    const body = z.object({ divisionKey: z.string().min(1).max(60) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'Choose where it belongs on the website.' });
    const result = await publishToWebsite(k.kind, k.id, { divisionKey: body.data.divisionKey, actorEmail: actor.email });
    await recordAudit({ actorId: actor.id, actorEmail: actor.email, action: 'POST_PUBLISHED_TO_WEBSITE', targetType: k.kind === 'post' ? 'HeadquartersPost' : k.kind === 'update' ? 'UpdatePost' : 'Announcement', targetId: k.id });
    res.json(result);
  }));
  router.delete('/:kind/:id/website', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const k = parse(req, res);
    if (!k) return;
    const actor = await resolveActor(req);
    if (!actor) return res.status(403).json({ error: 'Forbidden.' });
    const result = await takeOffWebsite(k.kind, k.id);
    await recordAudit({ actorId: actor.id, actorEmail: actor.email, action: 'POST_TAKEN_OFF_WEBSITE', targetType: k.kind === 'post' ? 'HeadquartersPost' : k.kind === 'update' ? 'UpdatePost' : 'Announcement', targetId: k.id });
    res.json(result);
  }));
  router.use(onError);
  return router;
}

export const adminSharedRoutes = (() => {
  const router = Router();
  router.use(requireAuth, requireRole('ADMIN'));
  router.use(buildAdminRouter(async (req) => (req.user ? { id: req.user.id, email: req.user.email } : null)));
  return router;
})();

export const memberCentralSharedRoutes = (() => {
  const router = Router();
  router.use(requireMember);
  router.use(
    asyncHandler(async (req, res, next) => {
      if (!(await isCentralAdminPerson(req.member!.personId))) return res.status(403).json({ error: 'Forbidden.' });
      next();
    }),
  );
  router.use(
    buildAdminRouter(async (req) => {
      const user = await prisma.user.findUnique({ where: { personId: req.member!.personId }, select: { id: true, email: true, role: true, active: true } });
      return user && user.role === 'ADMIN' && user.active ? { id: user.id, email: user.email } : null;
    }),
  );
  return router;
})();
