import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { requireCsrf } from '../lib/csrf';
import { recordAudit } from '../lib/audit';
import { leadershipMutationLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import { parsePagination, paginatedResult } from '../lib/pagination';
import { getRecommendationCommunityGeneration } from '../lib/organizationalLeadershipRecommendation';

const router = Router();

// Phase 2C — Central Authority/Admin review of organizational (Community-
// generation) leadership recommendations. Deliberately separate from
// adminLeadership.ts (the existing, untouched, sole formal-appointment
// mechanism) and from adminCommunities.ts (the existing, untouched, sole
// Community-creation mechanism): a route here NEVER creates, updates, or
// ends a RoleAssignment, and NEVER creates, updates, or reparents a
// Community. Approving/rejecting a recommendation only changes this
// recommendation's own record — exactly the same absolute boundary
// adminLeadershipProposals.ts already established for Geography proposals.
router.use(requireAuth, requireRole('ADMIN'));

const listQuerySchema = z.object({
  status: z.enum(['PROPOSED', 'APPROVED', 'REJECTED', 'WITHDRAWN']).optional(),
});

// GET /api/admin/organizational-leadership-recommendations — Admin sees
// every recommendation globally, matching adminLeadershipProposals.ts's own
// unrestricted Admin visibility.
router.get('/organizational-leadership-recommendations', asyncHandler(async (req, res) => {
  const { page, pageSize, skip, take } = parsePagination(req);
  const q = listQuerySchema.parse(req.query);
  const where = q.status ? { status: q.status } : {};

  const [total, items] = await Promise.all([
    prisma.organizationalLeadershipRecommendation.count({ where }),
    prisma.organizationalLeadershipRecommendation.findMany({
      where,
      include: {
        proposedPerson: { select: { id: true, name: true } },
        proposedByPerson: { select: { id: true, name: true } },
        community: { select: { id: true, name: true } },
        decidedByUser: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
  ]);

  const withGeneration = await Promise.all(
    items.map(async (r) => ({ ...r, generation: await getRecommendationCommunityGeneration(r.communityId) })),
  );

  res.json(paginatedResult(withGeneration, total, page, pageSize));
}));

const decisionSchema = z.object({ decisionNote: z.string().trim().max(1000).optional() });

// PATCH /api/admin/organizational-leadership-recommendations/:id/approve —
// records a decision ONLY. Never creates a Community, never creates a
// RoleAssignment, never touches Community.parentId, never touches
// Headquarters — see this model's own schema comment. If Central
// Administration decides to actually create a Community and/or appoint this
// person, those remain fully separate actions via the existing, unmodified
// POST /api/admin/communities and POST /api/admin/role-assignments.
router.patch(
  '/organizational-leadership-recommendations/:id/approve',
  leadershipMutationLimiter,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const parsed = decisionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request.' });
    }

    const existing = await prisma.organizationalLeadershipRecommendation.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Organizational leadership recommendation not found.' });
    }
    if (existing.status !== 'PROPOSED') {
      return res.status(409).json({ error: 'This recommendation has already been decided or withdrawn.' });
    }

    const result = await prisma.organizationalLeadershipRecommendation.updateMany({
      where: { id, status: 'PROPOSED' },
      data: { status: 'APPROVED', decidedAt: new Date(), decidedByUserId: req.user!.id, decisionNote: parsed.data.decisionNote ?? null },
    });
    if (result.count === 0) {
      return res.status(409).json({ error: 'This recommendation has already been decided or withdrawn.' });
    }

    await recordAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'ORGANIZATIONAL_LEADERSHIP_RECOMMENDATION_APPROVED',
      targetType: 'OrganizationalLeadershipRecommendation',
      targetId: id,
    });

    const updated = await prisma.organizationalLeadershipRecommendation.findUnique({
      where: { id },
      include: {
        proposedPerson: { select: { id: true, name: true } },
        proposedByPerson: { select: { id: true, name: true } },
        community: { select: { id: true, name: true } },
        decidedByUser: { select: { id: true, name: true, email: true } },
      },
    });
    res.json(updated);
  }),
);

// PATCH /api/admin/organizational-leadership-recommendations/:id/reject —
// same pattern as approve, no Community/RoleAssignment mutation.
router.patch(
  '/organizational-leadership-recommendations/:id/reject',
  leadershipMutationLimiter,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const parsed = decisionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request.' });
    }

    const existing = await prisma.organizationalLeadershipRecommendation.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Organizational leadership recommendation not found.' });
    }
    if (existing.status !== 'PROPOSED') {
      return res.status(409).json({ error: 'This recommendation has already been decided or withdrawn.' });
    }

    const result = await prisma.organizationalLeadershipRecommendation.updateMany({
      where: { id, status: 'PROPOSED' },
      data: { status: 'REJECTED', decidedAt: new Date(), decidedByUserId: req.user!.id, decisionNote: parsed.data.decisionNote ?? null },
    });
    if (result.count === 0) {
      return res.status(409).json({ error: 'This recommendation has already been decided or withdrawn.' });
    }

    await recordAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'ORGANIZATIONAL_LEADERSHIP_RECOMMENDATION_REJECTED',
      targetType: 'OrganizationalLeadershipRecommendation',
      targetId: id,
    });

    const updated = await prisma.organizationalLeadershipRecommendation.findUnique({
      where: { id },
      include: {
        proposedPerson: { select: { id: true, name: true } },
        proposedByPerson: { select: { id: true, name: true } },
        community: { select: { id: true, name: true } },
        decidedByUser: { select: { id: true, name: true, email: true } },
      },
    });
    res.json(updated);
  }),
);

export default router;
