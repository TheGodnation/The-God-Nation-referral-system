import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { requireCsrf } from '../lib/csrf';
import { requireLinkedPerson } from '../lib/leadership';
import { recordAudit } from '../lib/audit';
import { asyncHandler } from '../lib/asyncHandler';
import { socialMutationLimiter } from '../lib/rateLimit';
import { getLeaderExactCommunityIds } from '../lib/privateMessaging';

// ---------------------------------------------------------------------------
// Reviewing member reports (see MemberReport). The central admin sees every
// report; a leader sees reports about people who are ACTIVE members of the
// groups they lead. Both can mark a report as dealt with, with a note.
//   /api/admin/member-reports    (admin)
//   /api/leader/member-reports   (leader)
// ---------------------------------------------------------------------------

const personSummary = { select: { id: true, name: true } };

function toRow(r: {
  id: string;
  targetType: string;
  targetId: string | null;
  reason: string;
  status: string;
  createdAt: Date;
  resolvedAt: Date | null;
  resolutionNote: string | null;
  reporter: { id: string; name: string };
  reported: { id: string; name: string };
}) {
  return {
    id: r.id,
    targetType: r.targetType,
    targetId: r.targetId,
    reason: r.reason,
    status: r.status,
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt,
    resolutionNote: r.resolutionNote,
    reporter: { personId: r.reporter.id, name: r.reporter.name },
    reported: { personId: r.reported.id, name: r.reported.name },
  };
}

const listQuery = z.object({ status: z.enum(['OPEN', 'RESOLVED']).default('OPEN') });
const resolveSchema = z.object({ note: z.string().trim().max(1000).optional() });

/** Reported people a leader may review: members of the groups they lead. */
async function leaderVisiblePersonIds(req: Request): Promise<string[]> {
  const communityIds = await getLeaderExactCommunityIds(req.leaderPersonId!);
  if (communityIds.length === 0) return [];
  const rows = await prisma.communityMembership.findMany({
    where: { status: 'ACTIVE', communityId: { in: communityIds } },
    select: { personId: true },
    distinct: ['personId'],
  });
  return rows.map((r) => r.personId);
}

// ----------------------------- Admin ---------------------------------------

export const adminMemberReportsRouter = Router();
adminMemberReportsRouter.use(requireAuth, requireRole('ADMIN'));

adminMemberReportsRouter.get('/', asyncHandler(async (req, res) => {
  const q = listQuery.safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: 'Invalid request.' });
  const rows = await prisma.memberReport.findMany({
    where: { status: q.data.status },
    include: { reporter: personSummary, reported: personSummary },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  res.json({ items: rows.map(toRow) });
}));

adminMemberReportsRouter.post('/:id/resolve', socialMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = resolveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid note.' });
  const report = await prisma.memberReport.findUnique({ where: { id: req.params.id } });
  if (!report) return res.status(404).json({ error: 'Report not found.' });
  await prisma.memberReport.update({
    where: { id: report.id },
    data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedByUserId: req.user!.id, resolutionNote: parsed.data.note || null },
  });
  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'MEMBER_REPORT_RESOLVED',
    targetType: 'MemberReport',
    targetId: report.id,
  });
  res.json({ ok: true });
}));

// ----------------------------- Leader --------------------------------------

export const leaderMemberReportsRouter = Router();
leaderMemberReportsRouter.use(requireAuth, requireRole('LEADER'), requireLinkedPerson);

leaderMemberReportsRouter.get('/', asyncHandler(async (req, res) => {
  const q = listQuery.safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: 'Invalid request.' });
  const visible = await leaderVisiblePersonIds(req);
  if (visible.length === 0) return res.json({ items: [] });
  const rows = await prisma.memberReport.findMany({
    where: { status: q.data.status, reportedPersonId: { in: visible } },
    include: { reporter: personSummary, reported: personSummary },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  res.json({ items: rows.map(toRow) });
}));

leaderMemberReportsRouter.post('/:id/resolve', socialMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = resolveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid note.' });
  const report = await prisma.memberReport.findUnique({ where: { id: req.params.id } });
  const visible = await leaderVisiblePersonIds(req);
  if (!report || !visible.includes(report.reportedPersonId)) return res.status(404).json({ error: 'Report not found.' });
  await prisma.memberReport.update({
    where: { id: report.id },
    data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedByPersonId: req.leaderPersonId!, resolutionNote: parsed.data.note || null },
  });
  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'MEMBER_REPORT_RESOLVED',
    targetType: 'MemberReport',
    targetId: report.id,
  });
  res.json({ ok: true });
}));
