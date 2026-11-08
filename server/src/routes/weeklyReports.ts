import { Router, type Request } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../lib/auth';
import { requireMember } from '../lib/memberAuth';
import { requireCsrf } from '../lib/csrf';
import { isCentralAdminPerson } from '../lib/centralAdmin';
import { leadershipMutationLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import { representedGeneration } from '../lib/representatives';
import {
  ReportError,
  currentFor,
  historyFor,
  leaderHistory,
  leadersOverview,
  recentSummaries,
  remind,
  saveSummary,
  submitReport,
  summaryFor,
} from '../lib/weeklyReports';

// Weekly reports. Three doors, one set of rules:
//  - a leader sends and reads their own reports (/api/member/weekly-report);
//  - the central admin sees every leader's colour and reports (admin dashboard, and the member profile);
//  - a representative sees only the leaders of their own generation and sends one summary a week.

const reportSchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  contacted: z.number().int().min(0).max(100000),
  needHelp: z.number().int().min(0).max(100000),
  prayerNeeds: z.string().trim().max(2000).optional().nullable(),
  note: z.string().trim().max(2000).optional().nullable(),
});
const remindSchema = z.object({ allLate: z.boolean().optional(), personIds: z.array(z.string().min(1)).max(2000).optional() });

const onError = (err: unknown, _req: Request, res: any, next: any) => {
  if (err instanceof ReportError) return res.status(err.status).json({ error: err.message });
  next(err);
};

// ---- The leader's own report ----
export const memberWeeklyReportRoutes = (() => {
  const router = Router();
  router.use(requireMember);
  router.get('/current', asyncHandler(async (req, res) => {
    res.json(await currentFor(req.member!.personId));
  }));
  router.get('/history', asyncHandler(async (req, res) => {
    await currentFor(req.member!.personId); // leaders only
    res.json({ items: await historyFor(req.member!.personId) });
  }));
  router.put('/', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const parsed = reportSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Enter how many people you contacted and how many need help (whole numbers).' });
    const d = parsed.data;
    res.json(await submitReport(req.member!.personId, { contacted: d.contacted, needHelp: d.needHelp, prayerNeeds: d.prayerNeeds || null, note: d.note || null }, d.weekStart));
  }));
  router.use(onError);
  return router;
})();

// ---- "My leaders": the central admin's view, or a representative's (limited to their generation) ----
function buildOverview(resolveGeneration: (req: Request) => Promise<number | null | 'DENIED'>, isAdminView: boolean) {
  const router = Router();
  const scope = async (req: Request, res: any): Promise<number | null | 'DENIED'> => {
    const g = await resolveGeneration(req);
    if (g === 'DENIED') res.status(403).json({ error: isAdminView ? 'Forbidden.' : 'Only the representative of a generation can use this.' });
    return g;
  };

  router.get('/overview', asyncHandler(async (req, res) => {
    const g = await scope(req, res);
    if (g === 'DENIED') return;
    const only = isAdminView && req.query.generation !== undefined && req.query.generation !== '' ? Number(req.query.generation) : g;
    res.json(await leadersOverview({ generation: Number.isInteger(only) ? (only as number) : null }));
  }));

  router.get('/leaders/:personId', asyncHandler(async (req, res) => {
    const g = await scope(req, res);
    if (g === 'DENIED') return;
    res.json(await leaderHistory(String(req.params.personId), { generation: g }));
  }));

  router.post('/remind', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const g = await scope(req, res);
    if (g === 'DENIED') return;
    const parsed = remindSchema.safeParse(req.body);
    if (!parsed.success || (!parsed.data.allLate && !(parsed.data.personIds?.length))) return res.status(400).json({ error: 'Choose who to remind.' });
    res.json(await remind({ ...parsed.data, generation: g }));
  }));

  if (isAdminView) {
    router.get('/summaries', asyncHandler(async (req, res) => {
      if ((await scope(req, res)) === 'DENIED') return;
      res.json({ items: await recentSummaries() });
    }));
  } else {
    router.get('/summary', asyncHandler(async (req, res) => {
      if ((await scope(req, res)) === 'DENIED') return;
      res.json(await summaryFor(req.member!.personId));
    }));
    router.put('/summary', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
      if ((await scope(req, res)) === 'DENIED') return;
      const parsed = z.object({ summary: z.string().max(5000) }).safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Please write a few words.' });
      res.json(await saveSummary(req.member!.personId, parsed.data.summary));
    }));
  }
  router.use(onError);
  return router;
}

export const adminWeeklyReportsRoutes = (() => {
  const router = Router();
  router.use(requireAuth, requireRole('ADMIN'));
  router.use(buildOverview(async () => null, true));
  return router;
})();

export const memberCentralWeeklyReportsRoutes = (() => {
  const router = Router();
  router.use(requireMember);
  router.use(
    asyncHandler(async (req, res, next) => {
      if (!(await isCentralAdminPerson(req.member!.personId))) return res.status(403).json({ error: 'Forbidden.' });
      next();
    }),
  );
  router.use(buildOverview(async () => null, true));
  return router;
})();

export const memberRepWeeklyReportsRoutes = (() => {
  const router = Router();
  router.use(requireMember);
  router.use(buildOverview(async (req) => (await representedGeneration(req.member!.personId)) ?? 'DENIED', false));
  return router;
})();

