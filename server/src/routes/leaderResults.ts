import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { requireLinkedPerson } from '../lib/leadership';
import { asyncHandler } from '../lib/asyncHandler';
import { parsePagination, paginatedResult } from '../lib/pagination';
import { getLeaderExactCommunityIds } from '../lib/privateMessaging';
import { adminSensitiveLimiter } from '../lib/rateLimit';
import { allResults, listResults, quizSummary, resultsCsv, RESULT_KINDS, type ResultFilter } from '../lib/examResults';

// A leader's view of every quiz and exam taken by the members of their own
// assemblies (the same people the Exam World table covers): the marks, a
// spreadsheet, and one quiz at a glance. Only ever those members — the
// people are resolved here on the server from the leader's own roles.
const router = Router();
router.use(requireAuth, requireRole('LEADER'), requireLinkedPerson);

async function myMemberIds(leaderPersonId: string): Promise<string[]> {
  const communityIds = await getLeaderExactCommunityIds(leaderPersonId);
  if (communityIds.length === 0) return [];
  const memberships = await prisma.communityMembership.findMany({
    where: { status: 'ACTIVE', communityId: { in: communityIds }, personId: { not: leaderPersonId } },
    select: { personId: true },
    distinct: ['personId'],
  });
  return memberships.map((m) => m.personId);
}

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .transform((s) => new Date(`${s}T00:00:00.000Z`))
  .refine((d) => !Number.isNaN(d.getTime()));

const querySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  kind: z.enum(RESULT_KINDS as [string, ...string[]]).optional(),
  from: day.optional(),
  to: day.optional(),
});

async function filterOf(req: any): Promise<ResultFilter | null> {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) return null;
  const q = parsed.data;
  return { ...q, kind: q.kind as ResultFilter['kind'], personIds: await myMemberIds(req.leaderPersonId!) };
}

// GET /api/leader/results
router.get('/results', asyncHandler(async (req, res) => {
  const filter = await filterOf(req);
  if (!filter) return res.status(400).json({ error: 'Invalid filter.' });
  const { page, pageSize, skip, take } = parsePagination(req);
  const { total, items } = await listResults(filter, skip, take);
  // A leader sees the marks, not the members' phone numbers.
  res.json(paginatedResult(items.map((r) => ({ ...r, whatsappNumber: '' })), total, page, pageSize));
}));

// GET /api/leader/results/export
router.get('/results/export', adminSensitiveLimiter, asyncHandler(async (req, res) => {
  const filter = await filterOf(req);
  if (!filter) return res.status(400).json({ error: 'Invalid filter.' });
  const rows = (await allResults(filter)).map((r) => ({ ...r, whatsappNumber: '' }));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="my-members-quiz-and-exam-results.csv"');
  res.send(resultsCsv(rows));
}));

// GET /api/leader/results/quiz/:assessmentId — the same at-a-glance summary,
// over this leader's members only, and without the answer key.
router.get('/results/quiz/:assessmentId', asyncHandler(async (req, res) => {
  const personIds = await myMemberIds(req.leaderPersonId!);
  const summary = await quizSummary(req.params.assessmentId, { personIds, detail: false });
  // Nothing taken by this leader's members: nothing to show (and no peeking at other quizzes).
  if (!summary || summary.taken === 0) return res.status(404).json({ error: 'Quiz not found.' });
  res.json(summary);
}));

export default router;
