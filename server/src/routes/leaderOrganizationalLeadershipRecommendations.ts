import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { requireCsrf } from '../lib/csrf';
import { recordAudit } from '../lib/audit';
import { leadershipMutationLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import { requireLinkedPerson } from '../lib/leadership';
import { parsePagination, paginatedResult } from '../lib/pagination';
import {
  isCommunityLeaderForRecommendation,
  personIsActiveCommunityMember,
  getRecommendationCommunityGeneration,
} from '../lib/organizationalLeadershipRecommendation';

const router = Router();

// Phase 2C — same requireLinkedPerson gate every other Leader route uses.
// This is a recommendation workflow only, exactly like
// leaderLeadershipProposals.ts's own precedent: nothing here ever creates,
// updates, or ends a RoleAssignment, and nothing here ever creates a
// Community. Formal Community creation and Leader appointment remain
// exclusively the existing Admin-only flows in adminCommunities.ts /
// adminLeadership.ts, completely untouched by this phase.
router.use(requireAuth, requireRole('LEADER'), requireLinkedPerson);

const createRecommendationSchema = z.object({
  proposedPersonId: z.string().min(1),
  communityId: z.string().min(1),
  note: z.string().trim().max(1000).optional(),
});

// POST /api/leader/organizational-leadership-recommendations — the acting
// Leader recommends a Person for future organizational leadership anchored
// to a Community they exactly, currently lead. communityId is only ever a
// REQUESTED target: isCommunityLeaderForRecommendation independently
// re-verifies the caller's own exact-match ACTIVE SCOPED_LEADER role for it
// server-side — no inherited, descendant, sibling, same-generation-peer, or
// Geography authority can ever substitute for this. proposedByPersonId is
// always req.leaderPersonId; the request body carries no such field, so a
// client can never assert one.
router.post(
  '/organizational-leadership-recommendations',
  leadershipMutationLimiter,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const parsed = createRecommendationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid recommendation.' });
    }
    const { proposedPersonId, communityId, note } = parsed.data;
    const proposedByPersonId = req.leaderPersonId!;

    if (proposedPersonId === proposedByPersonId) {
      return res.status(400).json({ error: 'A Person cannot recommend themselves.' });
    }

    // Authorization: the anchor Community must be exactly one the Leader
    // currently leads — never trusted merely because the client supplied
    // it, and never satisfied by a parent, child, sibling, or
    // same-generation peer Community.
    const authorized = await isCommunityLeaderForRecommendation(proposedByPersonId, communityId);
    if (!authorized) {
      return res.status(403).json({ error: 'You do not have an active scoped leader role for this exact Community.' });
    }

    const candidate = await prisma.person.findUnique({ where: { id: proposedPersonId } });
    if (!candidate) {
      return res.status(400).json({ error: 'Proposed Person not found.' });
    }

    // The candidate must already be an active member of this exact anchor
    // Community — mirrors LeadershipProposal's own candidate-eligibility
    // precedent (present within the recommendation's target scope), never a
    // requirement that they already hold any RoleAssignment.
    if (!(await personIsActiveCommunityMember(proposedPersonId, communityId))) {
      return res.status(400).json({ error: 'This person is not an active member of this Community.' });
    }

    let created;
    try {
      created = await prisma.organizationalLeadershipRecommendation.create({
        data: { proposedPersonId, communityId, proposedByPersonId, note: note ?? null },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return res.status(409).json({ error: 'A pending recommendation for this person and Community already exists.' });
      }
      throw err;
    }

    await recordAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'ORGANIZATIONAL_LEADERSHIP_RECOMMENDATION_CREATED',
      targetType: 'OrganizationalLeadershipRecommendation',
      targetId: created.id,
      metadata: { proposedPersonId, communityId, proposedByPersonId },
    });

    res.status(201).json(created);
  }),
);

// GET /api/leader/organizational-leadership-recommendations — a Leader sees
// ONLY their own recommendations, never another Leader's. Ownership is
// always req.leaderPersonId — query params can never select a different
// proposer.
router.get('/organizational-leadership-recommendations', asyncHandler(async (req, res) => {
  const { page, pageSize, skip, take } = parsePagination(req);
  const where = { proposedByPersonId: req.leaderPersonId! };

  const [total, items] = await Promise.all([
    prisma.organizationalLeadershipRecommendation.count({ where }),
    prisma.organizationalLeadershipRecommendation.findMany({
      where,
      include: {
        proposedPerson: { select: { id: true, name: true } },
        community: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
  ]);

  // Generation is derived fresh per row, never stored — exactly like every
  // other generation-derived value in this codebase.
  const withGeneration = await Promise.all(
    items.map(async (r) => ({ ...r, generation: await getRecommendationCommunityGeneration(r.communityId) })),
  );

  res.json(paginatedResult(withGeneration, total, page, pageSize));
}));

// POST /api/leader/organizational-leadership-recommendations/:id/withdraw —
// only the original proposer may withdraw their own recommendation, and
// only while it is still PROPOSED. Uses 404 (not 403) for a non-owned
// recommendation, matching leaderLeadershipProposals.ts's own convention of
// never confirming whether an id belongs to someone else.
router.post(
  '/organizational-leadership-recommendations/:id/withdraw',
  leadershipMutationLimiter,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const existing = await prisma.organizationalLeadershipRecommendation.findUnique({ where: { id } });
    if (!existing || existing.proposedByPersonId !== req.leaderPersonId) {
      return res.status(404).json({ error: 'Organizational leadership recommendation not found.' });
    }
    if (existing.status !== 'PROPOSED') {
      return res.status(409).json({ error: 'This recommendation has already been decided or withdrawn.' });
    }

    // Atomic, conditional update: the WHERE clause's own status check is the
    // real safety net against a race with a concurrent Admin decision.
    const result = await prisma.organizationalLeadershipRecommendation.updateMany({
      where: { id, status: 'PROPOSED' },
      data: { status: 'WITHDRAWN' },
    });
    if (result.count === 0) {
      return res.status(409).json({ error: 'This recommendation has already been decided or withdrawn.' });
    }

    const updated = await prisma.organizationalLeadershipRecommendation.findUnique({ where: { id } });
    res.json(updated);
  }),
);

export default router;
