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
import { notifyMemberReportReviewed } from '../lib/notifications';

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
  outcome: string | null;
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
    outcome: r.outcome,
    reporter: { personId: r.reporter.id, name: r.reporter.name },
    reported: { personId: r.reported.id, name: r.reported.name },
  };
}

/** For reports about a post or comment: what it said, so the reviewer knows without hunting for it. */
async function withPreviews<T extends { targetType: string; targetId: string | null }>(rows: T[]) {
  const postIds = rows.filter((r) => r.targetType === 'UPDATE_POST' && r.targetId).map((r) => r.targetId!);
  const commentIds = rows.filter((r) => r.targetType === 'UPDATE_COMMENT' && r.targetId).map((r) => r.targetId!);
  const [posts, comments] = await Promise.all([
    postIds.length ? prisma.updatePost.findMany({ where: { id: { in: postIds } }, select: { id: true, body: true, deletedAt: true } }) : [],
    commentIds.length ? prisma.updateComment.findMany({ where: { id: { in: commentIds } }, select: { id: true, body: true, deletedAt: true } }) : [],
  ]);
  const text = new Map([...posts, ...comments].map((x) => [x.id, x.deletedAt ? null : x.body.slice(0, 400)]));
  return rows.map((r) => ({ ...r, targetPreview: r.targetId ? (text.get(r.targetId) ?? null) : null }));
}

const listQuery = z.object({ status: z.enum(['OPEN', 'RESOLVED']).default('OPEN') });
const resolveSchema = z.object({
  // The person who reported is told this, and the note.
  outcome: z.enum(['VIOLATION', 'NO_VIOLATION']).optional(),
  note: z.string().trim().max(1000).optional(),
  // With a violation: also take down the reported post / comment.
  removeContent: z.boolean().optional(),
});

type Resolver = { userId?: string; personId?: string };

/** Closes a report: records what was found, optionally removes the reported post or comment, and tells the reporter. */
async function finishReport(
  report: { id: string; reporterPersonId: string; targetType: string; targetId: string | null },
  by: Resolver,
  d: z.infer<typeof resolveSchema>,
) {
  await prisma.memberReport.update({
    where: { id: report.id },
    data: {
      status: 'RESOLVED',
      resolvedAt: new Date(),
      resolvedByUserId: by.userId ?? null,
      resolvedByPersonId: by.personId ?? null,
      resolutionNote: d.note || null,
      outcome: d.outcome ?? null,
    },
  });
  if (d.outcome === 'VIOLATION' && d.removeContent && report.targetId) {
    const now = new Date();
    const who = by.userId ? { deletedByUserId: by.userId, deletedByPersonId: null } : { deletedByPersonId: by.personId ?? null, deletedByUserId: null };
    if (report.targetType === 'UPDATE_POST') {
      await prisma.updatePost.updateMany({ where: { id: report.targetId, deletedAt: null }, data: { deletedAt: now, ...who } });
    } else if (report.targetType === 'UPDATE_COMMENT') {
      await prisma.updateComment.updateMany({ where: { id: report.targetId, deletedAt: null }, data: { deletedAt: now, ...who } });
    }
  }
  // The reporter always hears back. Best-effort: never fails the review itself.
  await notifyMemberReportReviewed(report, d.outcome ?? null, d.note || null).catch(() => {});
}

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
  res.json({ items: await withPreviews(rows.map(toRow)) });
}));

adminMemberReportsRouter.post('/:id/resolve', socialMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = resolveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid note.' });
  const report = await prisma.memberReport.findUnique({ where: { id: req.params.id } });
  if (!report) return res.status(404).json({ error: 'Report not found.' });
  await finishReport(report, { userId: req.user!.id }, parsed.data);
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
  res.json({ items: await withPreviews(rows.map(toRow)) });
}));

leaderMemberReportsRouter.post('/:id/resolve', socialMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = resolveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid note.' });
  const report = await prisma.memberReport.findUnique({ where: { id: req.params.id } });
  const visible = await leaderVisiblePersonIds(req);
  if (!report || !visible.includes(report.reportedPersonId)) return res.status(404).json({ error: 'Report not found.' });
  await finishReport(report, { personId: req.leaderPersonId! }, parsed.data);
  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'MEMBER_REPORT_RESOLVED',
    targetType: 'MemberReport',
    targetId: report.id,
  });
  res.json({ ok: true });
}));
