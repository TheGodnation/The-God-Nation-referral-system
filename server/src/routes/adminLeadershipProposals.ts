import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { requireCsrf } from '../lib/csrf';
import { recordAudit } from '../lib/audit';
import { leadershipMutationLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import { parsePagination, paginatedResult } from '../lib/pagination';

const router = Router();

// Phase 3L — Central Authority/Admin review of geographical leadership
// proposals. Deliberately separate from adminLeadership.ts (the existing,
// untouched, sole formal-appointment mechanism): a route here NEVER
// creates, updates, or ends a RoleAssignment. Approving/rejecting a
// proposal only changes this proposal's own record; Central Authority must
// separately use POST /api/admin/role-assignments if they decide to
// actually appoint the person.
router.use(requireAuth, requireRole('ADMIN'));

const listQuerySchema = z.object({
  status: z.enum(['PROPOSED', 'APPROVED', 'REJECTED', 'WITHDRAWN']).optional(),
});

// GET /api/admin/leadership-proposals — Admin sees every proposal globally,
// matching the existing unrestricted Admin visibility already established
// for RoleAssignments and FollowUpAssignments.
router.get('/leadership-proposals', asyncHandler(async (req, res) => {
  const { page, pageSize, skip, take } = parsePagination(req);
  const q = listQuerySchema.parse(req.query);
  const where = q.status ? { status: q.status } : {};

  const [total, items] = await Promise.all([
    prisma.leadershipProposal.count({ where }),
    prisma.leadershipProposal.findMany({
      where,
      include: {
        proposedPerson: { select: { id: true, name: true } },
        proposedByPerson: { select: { id: true, name: true } },
        geography: { select: { id: true, name: true, type: true } },
        decidedByUser: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
  ]);

  res.json(paginatedResult(items, total, page, pageSize));
}));

const decisionSchema = z.object({ decisionNote: z.string().trim().max(1000).optional() });

// PATCH /api/admin/leadership-proposals/:id/approve — records a decision
// ONLY. This route must never create, update, or end a RoleAssignment; if
// Central Authority decides to actually appoint this person, that remains
// a fully separate action via the existing, unmodified
// POST /api/admin/role-assignments.
router.patch('/leadership-proposals/:id/approve', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const parsed = decisionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request.' });
  }

  const existing = await prisma.leadershipProposal.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ error: 'Leadership proposal not found.' });
  }
  if (existing.status !== 'PROPOSED') {
    return res.status(409).json({ error: 'This proposal has already been decided or withdrawn.' });
  }

  // Atomic, conditional update — the WHERE clause's status check guards
  // against a race with a concurrent reject/withdraw, so two competing
  // decisions can never both succeed.
  const result = await prisma.leadershipProposal.updateMany({
    where: { id, status: 'PROPOSED' },
    data: { status: 'APPROVED', decidedAt: new Date(), decidedByUserId: req.user!.id, decisionNote: parsed.data.decisionNote ?? null },
  });
  if (result.count === 0) {
    return res.status(409).json({ error: 'This proposal has already been decided or withdrawn.' });
  }

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'LEADERSHIP_PROPOSAL_APPROVED',
    targetType: 'LeadershipProposal',
    targetId: id,
  });

  const updated = await prisma.leadershipProposal.findUnique({
    where: { id },
    include: {
      proposedPerson: { select: { id: true, name: true } },
      proposedByPerson: { select: { id: true, name: true } },
      geography: { select: { id: true, name: true, type: true } },
      decidedByUser: { select: { id: true, name: true, email: true } },
    },
  });
  res.json(updated);
}));

// PATCH /api/admin/leadership-proposals/:id/reject — same pattern as
// approve, no RoleAssignment mutation.
router.patch('/leadership-proposals/:id/reject', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const parsed = decisionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request.' });
  }

  const existing = await prisma.leadershipProposal.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ error: 'Leadership proposal not found.' });
  }
  if (existing.status !== 'PROPOSED') {
    return res.status(409).json({ error: 'This proposal has already been decided or withdrawn.' });
  }

  const result = await prisma.leadershipProposal.updateMany({
    where: { id, status: 'PROPOSED' },
    data: { status: 'REJECTED', decidedAt: new Date(), decidedByUserId: req.user!.id, decisionNote: parsed.data.decisionNote ?? null },
  });
  if (result.count === 0) {
    return res.status(409).json({ error: 'This proposal has already been decided or withdrawn.' });
  }

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'LEADERSHIP_PROPOSAL_REJECTED',
    targetType: 'LeadershipProposal',
    targetId: id,
  });

  const updated = await prisma.leadershipProposal.findUnique({
    where: { id },
    include: {
      proposedPerson: { select: { id: true, name: true } },
      proposedByPerson: { select: { id: true, name: true } },
      geography: { select: { id: true, name: true, type: true } },
      decidedByUser: { select: { id: true, name: true, email: true } },
    },
  });
  res.json(updated);
}));

export default router;
