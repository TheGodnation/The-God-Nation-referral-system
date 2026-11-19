import { Router, type Request } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { requireMember } from '../lib/memberAuth';
import { requireCsrf } from '../lib/csrf';
import { isCentralAdminPerson } from '../lib/centralAdmin';
import { leadershipMutationLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import { recordAudit } from '../lib/audit';
import { adminCelebration, celebrationSchema, publicCelebration, saveCelebration, teachingListNames } from '../lib/celebration';

// The "Congratulations" page. Anyone can read it once it is switched on (GET /api/celebration). The central admin writes it,
// from the admin dashboard or from their own member profile (same rules in both places).

type Actor = { id: string; email: string };

export const publicCelebrationRoutes = (() => {
  const router = Router();
  router.get('/', asyncHandler(async (_req, res) => {
    const page = await publicCelebration();
    if (!page) return res.status(404).json({ error: 'Not open yet.' });
    res.set('Cache-Control', 'public, max-age=60');
    res.json(page);
  }));
  return router;
})();

function buildAdminRouter(resolveActor: (req: Request) => Promise<Actor | null>) {
  const router = Router();
  router.get('/', asyncHandler(async (_req, res) => {
    res.json(await adminCelebration());
  }));
  router.get('/teaching-names', asyncHandler(async (_req, res) => {
    res.json({ names: await teachingListNames() });
  }));
  router.put('/', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const parsed = celebrationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Check the words and names and try again.' });
    const actor = await resolveActor(req);
    if (!actor) return res.status(403).json({ error: 'Forbidden.' });
    const saved = await saveCelebration(parsed.data);
    await recordAudit({ actorId: actor.id, actorEmail: actor.email, action: 'CELEBRATION_SAVED', targetType: 'Celebration', targetId: 'main', metadata: { published: parsed.data.published, names: parsed.data.names.length } });
    res.json(saved);
  }));
  return router;
}

export const adminCelebrationRoutes = (() => {
  const router = Router();
  router.use(requireAuth, requireRole('ADMIN'));
  router.use(buildAdminRouter(async (req) => (req.user ? { id: req.user.id, email: req.user.email } : null)));
  return router;
})();

export const memberCentralCelebrationRoutes = (() => {
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
