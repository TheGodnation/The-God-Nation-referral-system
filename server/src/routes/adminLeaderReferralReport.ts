import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { requireMember } from '../lib/memberAuth';
import { isCentralAdminPerson } from '../lib/centralAdmin';
import { adminSensitiveLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import { recordAudit } from '../lib/audit';
import { leaderReferralCsv, leaderReferralReport } from '../lib/leaderReferralReport';

// For the central admin: how each leader did under the first referral system (link clicks, sign-ups, taps on "join the
// WhatsApp group", people now in the app and in an assembly), with a spreadsheet. Offered twice — in the admin dashboard
// and in the central admin's own member profile — with the same rules. Leaders only ever see their own conversion rate.
type Actor = { id: string; email: string };
const querySchema = z.object({ includeTestData: z.enum(['true', 'false']).optional() });

function buildRouter(resolveActor: (req: Request) => Promise<Actor | null>) {
  const router = Router();

  router.get('/', asyncHandler(async (req, res) => {
    const q = querySchema.safeParse(req.query);
    if (!q.success) return res.status(400).json({ error: 'Invalid filter.' });
    res.json(await leaderReferralReport({ includeTestData: q.data.includeTestData === 'true' }));
  }));

  router.get('/export', adminSensitiveLimiter, asyncHandler(async (req, res) => {
    const q = querySchema.safeParse(req.query);
    if (!q.success) return res.status(400).json({ error: 'Invalid filter.' });
    const actor = await resolveActor(req);
    if (!actor) return res.status(403).json({ error: 'Forbidden.' });
    const report = await leaderReferralReport({ includeTestData: q.data.includeTestData === 'true' });
    await recordAudit({ actorId: actor.id, actorEmail: actor.email, action: 'LEADER_REFERRAL_REPORT_EXPORTED', targetType: 'User', metadata: { leaders: report.rows.length, referred: report.totals.referred } });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="leaders-referral-report.csv"');
    res.send(`﻿${leaderReferralCsv(report)}`);
  }));

  return router;
}

export const adminLeaderReferralReportRoutes = (() => {
  const router = Router();
  router.use(requireAuth, requireRole('ADMIN'));
  router.use(buildRouter(async (req) => (req.user ? { id: req.user.id, email: req.user.email } : null)));
  return router;
})();

export const memberCentralLeaderReferralReportRoutes = (() => {
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
