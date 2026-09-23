import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { requireCsrf } from '../lib/csrf';
import { recordAudit } from '../lib/audit';
import { leadershipMutationLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import { requireLinkedPerson, isGeographyInLeaderScope } from '../lib/leadership';
import { getDescendantGeographyIds } from '../lib/tree';
import { parsePagination, paginatedResult } from '../lib/pagination';

const router = Router();

// Every route here requires an authenticated Leader whose User is linked to
// a Person — the same requireLinkedPerson gate every other Leader route
// uses. This is a recommendation workflow only: nothing here ever creates,
// updates, or ends a RoleAssignment. Formal appointment remains exclusively
// the existing Admin-only flow in adminLeadership.ts, untouched by Phase 3L.
router.use(requireAuth, requireRole('LEADER'), requireLinkedPerson);

const createProposalSchema = z.object({
  proposedPersonId: z.string().min(1),
  geographyId: z.string().min(1),
  note: z.string().trim().max(1000).optional(),
});

// POST /api/leader/leadership-proposals — Phase 3L. The acting Leader
// recommends a Person for leadership of a Geography node they are
// authorized to see (their own assigned node or a descendant of it —
// reuses isGeographyInLeaderScope, the exact same Phase 3K helper the
// roster uses, completely unmodified). The candidate's OWN current
// GeographicAssignment is looked up server-side and must itself fall
// within the proposed geographyId's subtree — the request body carries no
// "candidate geography" field, so a client can never assert one.
router.post('/leadership-proposals', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = createProposalSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid leadership proposal.' });
  }
  const { proposedPersonId, geographyId, note } = parsed.data;
  const proposedByPersonId = req.leaderPersonId!;

  if (proposedPersonId === proposedByPersonId) {
    return res.status(400).json({ error: 'A Person cannot propose themselves.' });
  }

  // Authorization: the proposed geography must be the Leader's own assigned
  // node or a descendant of it — never trusted merely because the client
  // supplied it.
  const authorized = await isGeographyInLeaderScope(proposedByPersonId, geographyId);
  if (!authorized) {
    return res.status(403).json({ error: 'You do not have an active scoped leader role for this exact Geography.' });
  }

  const candidate = await prisma.person.findUnique({ where: { id: proposedPersonId } });
  if (!candidate) {
    return res.status(400).json({ error: 'Proposed Person not found.' });
  }

  // The candidate's real, current GeographicAssignment is the sole source
  // of truth for where they actually are — never a client-supplied value.
  const candidateAssignment = await prisma.geographicAssignment.findUnique({ where: { personId: proposedPersonId } });
  if (!candidateAssignment || candidateAssignment.status !== 'ACTIVE') {
    return res.status(400).json({ error: 'This person does not have an active geographic assignment.' });
  }
  const proposedSubtree = await getDescendantGeographyIds(geographyId);
  if (!proposedSubtree.includes(candidateAssignment.geographyId)) {
    return res.status(400).json({ error: 'This person is not within the proposed geographic scope.' });
  }

  // Redundant-proposal guard: if the candidate is already an ACTIVE
  // SCOPED_LEADER for this exact geography, there is nothing to propose.
  // Being a Leader elsewhere is explicitly NOT blocked — Central Authority
  // may still decide to appoint them to an additional geography.
  const alreadyLeading = await prisma.roleAssignment.findFirst({
    where: { personId: proposedPersonId, roleType: 'SCOPED_LEADER', status: 'ACTIVE', geographyId },
  });
  if (alreadyLeading) {
    return res.status(400).json({ error: 'This person is already an active leader for this exact Geography.' });
  }

  let created;
  try {
    created = await prisma.leadershipProposal.create({
      data: { proposedPersonId, geographyId, proposedByPersonId, note: note ?? null },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return res.status(409).json({ error: 'A pending proposal for this person and geography already exists.' });
    }
    throw err;
  }

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'LEADERSHIP_PROPOSAL_CREATED',
    targetType: 'LeadershipProposal',
    targetId: created.id,
    metadata: { proposedPersonId, geographyId, proposedByPersonId },
  });

  res.status(201).json(created);
}));

// GET /api/leader/leadership-proposals — a Leader sees ONLY their own
// proposals, never another Leader's. Ownership is always req.leaderPersonId
// — query params can never select a different proposer.
router.get('/leadership-proposals', asyncHandler(async (req, res) => {
  const { page, pageSize, skip, take } = parsePagination(req);
  const where = { proposedByPersonId: req.leaderPersonId! };

  const [total, items] = await Promise.all([
    prisma.leadershipProposal.count({ where }),
    prisma.leadershipProposal.findMany({
      where,
      include: {
        proposedPerson: { select: { id: true, name: true } },
        geography: { select: { id: true, name: true, type: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
  ]);

  res.json(paginatedResult(items, total, page, pageSize));
}));

// POST /api/leader/leadership-proposals/:id/withdraw — only the original
// proposer may withdraw their own proposal, and only while it is still
// PROPOSED. Uses 404 (not 403) for a non-owned proposal, matching the
// existing Follow-Up convention of never confirming whether an id belongs
// to someone else.
router.post('/leadership-proposals/:id/withdraw', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const existing = await prisma.leadershipProposal.findUnique({ where: { id } });
  if (!existing || existing.proposedByPersonId !== req.leaderPersonId) {
    return res.status(404).json({ error: 'Leadership proposal not found.' });
  }
  if (existing.status !== 'PROPOSED') {
    return res.status(409).json({ error: 'This proposal has already been decided or withdrawn.' });
  }

  // Atomic, conditional update: the WHERE clause's own status check is the
  // real safety net against a race with a concurrent Admin decision — if
  // another request already changed the status, this matches zero rows.
  const result = await prisma.leadershipProposal.updateMany({
    where: { id, status: 'PROPOSED' },
    data: { status: 'WITHDRAWN' },
  });
  if (result.count === 0) {
    return res.status(409).json({ error: 'This proposal has already been decided or withdrawn.' });
  }

  const updated = await prisma.leadershipProposal.findUnique({ where: { id } });
  res.json(updated);
}));

export default router;
