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
import { RepresentativeError, appoint, eligibleLeaders, end, overview, representedGeneration } from '../lib/representatives';

// Appointing and ending representatives: only the central admin, offered twice with the same rules — in the
// admin dashboard and in the central admin's own member profile.
type Actor = { userId: string | null; email: string | null };

const appointSchema = z.object({ personId: z.string().min(1), generation: z.number().int().min(1).max(50) });

function build(resolveActor: (req: Request) => Promise<Actor | null>) {
  const router = Router();

  router.get('/overview', asyncHandler(async (_req, res) => {
    res.json({ generations: await overview() });
  }));

  router.get('/leaders', asyncHandler(async (req, res) => {
    res.json({ items: await eligibleLeaders(String(req.query.search ?? '')) });
  }));

  router.post('/appoint', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const parsed = appointSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Choose a leader and a generation.' });
    const actor = await resolveActor(req);
    const row = await appoint(parsed.data.personId, parsed.data.generation, actor?.userId ?? null);
    await recordAudit({ actorId: actor?.userId ?? null, actorEmail: actor?.email ?? null, action: 'REPRESENTATIVE_APPOINTED', targetType: 'GenerationRepresentative', targetId: row.id, metadata: { personId: row.personId, generation: row.generation } });
    res.status(201).json({ id: row.id });
  }));

  router.post('/:id/remove', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const actor = await resolveActor(req);
    const row = await end(String(req.params.id), actor?.userId ?? null);
    await recordAudit({ actorId: actor?.userId ?? null, actorEmail: actor?.email ?? null, action: 'REPRESENTATIVE_ENDED', targetType: 'GenerationRepresentative', targetId: row.id, metadata: { personId: row.personId, generation: row.generation } });
    res.json({ ok: true });
  }));

  router.use((err: unknown, _req: Request, res: any, next: any) => {
    if (err instanceof RepresentativeError) return res.status(err.status).json({ error: err.message });
    next(err);
  });
  return router;
}

export const adminRepresentativesRoutes = (() => {
  const router = Router();
  router.use(requireAuth, requireRole('ADMIN'));
  router.use(build(async (req) => (req.user ? { userId: req.user.id, email: req.user.email } : null)));
  return router;
})();

export const memberCentralRepresentativesRoutes = (() => {
  const router = Router();
  router.use(requireMember);
  router.use(
    asyncHandler(async (req, res, next) => {
      if (!(await isCentralAdminPerson(req.member!.personId))) return res.status(403).json({ error: 'Forbidden.' });
      next();
    }),
  );
  router.use(
    build(async (req) => {
      const user = await prisma.user.findUnique({ where: { personId: req.member!.personId }, select: { id: true, email: true, role: true, active: true } });
      return user && user.role === 'ADMIN' && user.active ? { userId: user.id, email: user.email } : null;
    }),
  );
  return router;
})();

// Whether the signed-in member currently represents a generation (and which) — used to show their tools.
export const memberRepresentativeRoutes = (() => {
  const router = Router();
  router.use(requireMember);
  router.get('/me', asyncHandler(async (req, res) => {
    res.json({ generation: await representedGeneration(req.member!.personId) });
  }));
  return router;
})();
