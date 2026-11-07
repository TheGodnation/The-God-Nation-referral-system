import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { requireMember } from '../lib/memberAuth';
import { requireCsrf } from '../lib/csrf';
import { isCentralAdminPerson } from '../lib/centralAdmin';
import { adminSensitiveLimiter, leadershipMutationLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import { recordAudit } from '../lib/audit';
import { appointLeader } from '../lib/cells';
import { completionCsv, teachingCompletion } from '../lib/teachingCompletion';

// For the central admin: who did the teachings (handed in the quiz), whether they passed, as a list and a spreadsheet,
// and a one-tap "make leader" for the people on it. Offered twice — in the admin dashboard and in the central admin's
// own member profile — with the same rules.
type Actor = { id: string; email: string };

const filterSchema = z.object({
  communityId: z.string().min(1).max(64).optional(),
  includeTestData: z.enum(['true', 'false']).optional(),
});

function buildRouter(resolveActor: (req: Request) => Promise<Actor | null>) {
  const router = Router();

  // The assemblies that have teachings, with how many, to choose from.
  router.get('/assemblies', asyncHandler(async (_req, res) => {
    const groups = await prisma.teaching.groupBy({ by: ['communityId'], where: { message: { deletedAt: null } }, _count: { _all: true } });
    const communities = await prisma.community.findMany({ where: { id: { in: groups.map((g) => g.communityId) } }, select: { id: true, name: true } });
    const nameOf = new Map(communities.map((c) => [c.id, c.name]));
    res.json({ items: groups.map((g) => ({ id: g.communityId, name: nameOf.get(g.communityId) ?? '', teachings: g._count._all })).sort((a, b) => b.teachings - a.teachings) });
  }));

  router.get('/', asyncHandler(async (req, res) => {
    const q = filterSchema.safeParse(req.query);
    if (!q.success) return res.status(400).json({ error: 'Invalid filter.' });
    res.json(await teachingCompletion({ communityId: q.data.communityId, includeTestData: q.data.includeTestData === 'true' }));
  }));

  router.get('/export', adminSensitiveLimiter, asyncHandler(async (req, res) => {
    const q = filterSchema.safeParse(req.query);
    if (!q.success) return res.status(400).json({ error: 'Invalid filter.' });
    const actor = await resolveActor(req);
    if (!actor) return res.status(403).json({ error: 'Forbidden.' });
    const completion = await teachingCompletion({ communityId: q.data.communityId, includeTestData: q.data.includeTestData === 'true' });
    await recordAudit({ actorId: actor.id, actorEmail: actor.email, action: 'TEACHING_COMPLETION_EXPORTED', targetType: 'Teaching', metadata: { people: completion.people.length, teachings: completion.teachings.length } });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="who-did-the-teachings.csv"');
    res.send(`﻿${completionCsv(completion)}`);
  }));

  // Make a person on the list a leader of an assembly (the same appointment as everywhere else).
  router.post('/appoint', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const parsed = z.object({ personId: z.string().min(1), communityId: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'personId and communityId are required.' });
    const actor = await resolveActor(req);
    if (!actor) return res.status(403).json({ error: 'Forbidden.' });
    const result = await appointLeader(parsed.data.personId, parsed.data.communityId, actor);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.status(201).json({ id: result.id });
  }));

  return router;
}

export const adminTeachingCompletionRoutes = (() => {
  const router = Router();
  router.use(requireAuth, requireRole('ADMIN'));
  router.use(buildRouter(async (req) => (req.user ? { id: req.user.id, email: req.user.email } : null)));
  return router;
})();

export const memberCentralTeachingCompletionRoutes = (() => {
  const router = Router();
  router.use(requireMember);
  router.use(
    asyncHandler(async (req, res, next) => {
      if (!(await isCentralAdminPerson(req.member!.personId))) return res.status(403).json({ error: 'Forbidden.' });
      next();
    }),
  );
  router.use(
    buildRouter(async (req) => {
      const user = await prisma.user.findUnique({ where: { personId: req.member!.personId }, select: { id: true, email: true, role: true, active: true } });
      return user && user.role === 'ADMIN' && user.active ? { id: user.id, email: user.email } : null;
    }),
  );
  return router;
})();
