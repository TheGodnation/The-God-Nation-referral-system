import { Router, type Request } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { requireMember } from '../lib/memberAuth';
import { requireCsrf } from '../lib/csrf';
import { isCentralAdminPerson } from '../lib/centralAdmin';
import { leadershipMutationLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import { recordAudit } from '../lib/audit';
import { ShareError, isSharedKind, moreShared, publicItem, shareByLink, shareState, stopSharing } from '../lib/sharedPosts';

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
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ ...item, more: await moreShared({ kind, id }) });
  }));
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
    await recordAudit({ actorId: actor.id, actorEmail: actor.email, action: 'POST_SHARED_BY_LINK', targetType: k.kind === 'post' ? 'HeadquartersPost' : 'Announcement', targetId: k.id });
    res.json(result);
  }));
  router.delete('/:kind/:id/share', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const k = parse(req, res);
    if (!k) return;
    const actor = await resolveActor(req);
    if (!actor) return res.status(403).json({ error: 'Forbidden.' });
    const result = await stopSharing(k.kind, k.id);
    await recordAudit({ actorId: actor.id, actorEmail: actor.email, action: 'POST_SHARING_STOPPED', targetType: k.kind === 'post' ? 'HeadquartersPost' : 'Announcement', targetId: k.id });
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
