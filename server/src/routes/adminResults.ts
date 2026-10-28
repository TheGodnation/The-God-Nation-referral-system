import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../lib/auth';
import { adminSensitiveLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import { parsePagination, paginatedResult } from '../lib/pagination';
import { recordAudit } from '../lib/audit';
import { allResults, listResults, resultsCsv, RESULT_KINDS, type ResultFilter } from '../lib/examResults';

const router = Router();
router.use(requireAuth, requireRole('ADMIN'));

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .transform((s) => new Date(`${s}T00:00:00.000Z`))
  .refine((d) => !Number.isNaN(d.getTime()));

const querySchema = z.object({
  personId: z.string().min(1).max(64).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  kind: z.enum(RESULT_KINDS as [string, ...string[]]).optional(),
  communityId: z.string().min(1).max(64).optional(),
  from: day.optional(),
  to: day.optional(),
  includeTestData: z.enum(['true', 'false']).optional(),
});

function filterOf(query: unknown): ResultFilter | null {
  const parsed = querySchema.safeParse(query);
  if (!parsed.success) return null;
  const q = parsed.data;
  return { ...q, kind: q.kind as ResultFilter['kind'], includeTestData: q.includeTestData === 'true' };
}

// GET /api/admin/results — every submitted quiz / exam try, newest first,
// filtered by person (name, number or email), kind, assembly and dates.
router.get('/', asyncHandler(async (req, res) => {
  const filter = filterOf(req.query);
  if (!filter) return res.status(400).json({ error: 'Invalid filter.' });
  const { page, pageSize, skip, take } = parsePagination(req);
  const { total, items } = await listResults(filter, skip, take);
  res.json(paginatedResult(items, total, page, pageSize));
}));

// GET /api/admin/results/export — the same filter as a spreadsheet (CSV).
router.get('/export', adminSensitiveLimiter, asyncHandler(async (req, res) => {
  const filter = filterOf(req.query);
  if (!filter) return res.status(400).json({ error: 'Invalid filter.' });
  const rows = await allResults(filter);
  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'EXAM_RESULTS_EXPORTED',
    targetType: 'Attempt',
    metadata: { rowCount: rows.length },
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="quiz-and-exam-results.csv"');
  res.send(resultsCsv(rows));
}));

export default router;
