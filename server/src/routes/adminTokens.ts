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
import { adminTokenSummary, setTokensStart } from '../lib/tokens';

// King's Token for the central admin: the start day ("Start counting"), tokens
// earned, and the foundation's balance. Offered twice — in the admin dashboard
// and in the central admin's own member profile — with the same rules.
type Actor = { id: string; email: string };

function buildTokensRouter(resolveActor: (req: Request) => Promise<Actor | null>) {
  const router = Router();

  router.get('/summary', asyncHandler(async (_req, res) => {
    res.json(await adminTokenSummary());
  }));

  // Either start now, or choose the day it starts (a day in the future).
  const startSchema = z.union([z.object({ now: z.literal(true) }), z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })]);
  router.put('/start', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const parsed = startSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Choose "start now" or a day.' });
    const actor = await resolveActor(req);
    if (!actor) return res.status(403).json({ error: 'Forbidden.' });
    const at = 'now' in parsed.data ? new Date() : new Date(`${parsed.data.date}T00:00:00.000Z`);
    const result = await setTokensStart(at);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    await recordAudit({ actorId: actor.id, actorEmail: actor.email, action: 'TOKENS_START_SET', targetType: 'Settings', targetId: 'singleton', metadata: { startsAt: result.startsAt } });
    res.json(await adminTokenSummary());
  }));

  // Spending Earned tokens toward a book: the switch, what a token is worth in francs, the most of a price tokens can pay.
  const spendSchema = z.object({
    enabled: z.boolean(),
    valueFcfa: z.number().positive().max(100000),
    maxPercent: z.number().int().min(1).max(100),
  });
  router.put('/spend-settings', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const parsed = spendSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'A token is worth more than 0 francs, and tokens can pay from 1% to 100% of a price.' });
    const actor = await resolveActor(req);
    if (!actor) return res.status(403).json({ error: 'Forbidden.' });
    const d = parsed.data;
    const data = { tokenSpendEnabled: d.enabled, tokenValueFcfa: d.valueFcfa, tokenSpendMaxPercent: d.maxPercent };
    await prisma.settings.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', ...data }, update: data });
    await recordAudit({ actorId: actor.id, actorEmail: actor.email, action: 'TOKEN_SPEND_SETTINGS_UPDATED', targetType: 'Settings', targetId: 'singleton', metadata: { ...d } });
    res.json(await adminTokenSummary());
  }));

  return router;
}

// Admin dashboard (admin sign-in).
export const adminTokensRoutes = (() => {
  const router = Router();
  router.use(requireAuth, requireRole('ADMIN'));
  router.use(buildTokensRouter(async (req) => (req.user ? { id: req.user.id, email: req.user.email } : null)));
  return router;
})();

// The central admin's own member profile (member sign-in).
export const memberCentralTokensRoutes = (() => {
  const router = Router();
  router.use(requireMember);
  router.use(
    asyncHandler(async (req, res, next) => {
      if (!(await isCentralAdminPerson(req.member!.personId))) return res.status(403).json({ error: 'Forbidden.' });
      next();
    }),
  );
  router.use(
    buildTokensRouter(async (req) => {
      const user = await prisma.user.findUnique({ where: { personId: req.member!.personId }, select: { id: true, email: true, role: true, active: true } });
      return user && user.role === 'ADMIN' && user.active ? { id: user.id, email: user.email } : null;
    }),
  );
  return router;
})();
