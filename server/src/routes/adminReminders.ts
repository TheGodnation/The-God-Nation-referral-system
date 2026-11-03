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
import { emailConfigured } from '../lib/email';
import { reminderPending, reminderStats } from '../lib/memberReminders';

// The central admin's reminder switch: on/off, how many quiet days before "we miss
// you", the daily cap, and what would go out now and what went out recently.
// Offered in the admin dashboard and in the central admin's own member profile.
type Actor = { id: string; email: string };

async function summary() {
  const s = await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { remindersEnabled: true, reminderQuietDays: true, reminderDailyCap: true } });
  const [stats, pending] = await Promise.all([reminderStats(), reminderPending()]);
  return {
    enabled: s?.remindersEnabled ?? false,
    quietDays: s?.reminderQuietDays ?? 7,
    dailyCap: s?.reminderDailyCap ?? 40,
    emailConfigured,
    sentToday: stats.sentToday,
    last7: stats.last7,
    pending,
  };
}

function build(resolveActor: (req: Request) => Promise<Actor | null>) {
  const router = Router();
  router.get('/', asyncHandler(async (_req, res) => res.json(await summary())));

  const putSchema = z.object({
    enabled: z.boolean(),
    quietDays: z.number().int().min(1).max(90),
    dailyCap: z.number().int().min(1).max(500),
  });
  router.put('/', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const parsed = putSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Quiet days must be from 1 to 90, and the daily limit from 1 to 500.' });
    const actor = await resolveActor(req);
    if (!actor) return res.status(403).json({ error: 'Forbidden.' });
    const d = parsed.data;
    const data = { remindersEnabled: d.enabled, reminderQuietDays: d.quietDays, reminderDailyCap: d.dailyCap };
    await prisma.settings.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', ...data }, update: data });
    await recordAudit({ actorId: actor.id, actorEmail: actor.email, action: 'REMINDER_SETTINGS_UPDATED', targetType: 'Settings', targetId: 'singleton', metadata: { ...d } });
    res.json(await summary());
  }));
  return router;
}

export const adminRemindersRoutes = (() => {
  const router = Router();
  router.use(requireAuth, requireRole('ADMIN'));
  router.use(build(async (req) => (req.user ? { id: req.user.id, email: req.user.email } : null)));
  return router;
})();

export const memberCentralRemindersRoutes = (() => {
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
      return user && user.role === 'ADMIN' && user.active ? { id: user.id, email: user.email } : null;
    }),
  );
  return router;
})();
