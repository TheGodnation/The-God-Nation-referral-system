import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { requireCsrf } from '../lib/csrf';
import { recordAudit } from '../lib/audit';
import { leadershipMutationLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import { requireLinkedPerson, findActiveScopedRole, personBelongsToContext, contextTargetExists } from '../lib/leadership';
import { parsePagination, paginatedResult } from '../lib/pagination';
import { computeAttentionForLeader } from '../lib/followUpAttention';

const router = Router();

// Every route here requires an authenticated Leader whose User is linked to
// a Person (see requireLinkedPerson) — an Admin never needs this and never
// hits these routes; Admin-side Phase 3D actions live in adminLeadership.ts.
router.use(requireAuth, requireRole('LEADER'), requireLinkedPerson);

// GET /api/leader/role-assignments — the acting Leader's OWN active scoped
// roles only. Not in the originally suggested endpoint list, but required
// by the UI: it's what gates whether "My Follow-Up" shows at all, and
// supplies the exact Community/Geography scope options the create-follow-up
// form must offer (never letting the client submit an arbitrary scope).
router.get('/role-assignments', asyncHandler(async (req, res) => {
  const items = await prisma.roleAssignment.findMany({
    where: { personId: req.leaderPersonId, roleType: 'SCOPED_LEADER', status: 'ACTIVE' },
    include: {
      community: { select: { id: true, name: true } },
      geography: { select: { id: true, name: true, type: true } },
    },
    orderBy: { assignedAt: 'desc' },
  });
  res.json({ items });
}));

// GET /api/leader/follow-ups — a Leader sees ONLY their own assignments,
// never another Leader's, even one sharing the same scope.
router.get('/follow-ups', asyncHandler(async (req, res) => {
  const items = await prisma.followUpAssignment.findMany({
    where: { followerId: req.leaderPersonId },
    include: {
      followedPerson: { select: { id: true, name: true } },
      contacts: { orderBy: { contactedAt: 'desc' }, take: 1 },
    },
    orderBy: { assignedAt: 'desc' },
  });
  res.json({ items });
}));

// GET /api/leader/follow-ups/attention — Phase 3I. A derived, read-only view
// of the authenticated Leader's own ACTIVE assignments that currently need
// attention (see lib/followUpAttention.ts for the fixed classification
// rule). Ownership is the same followerId = req.leaderPersonId model as
// every other route in this file — no Community/Geography hierarchy, no
// client-supplied Person id. Classification depends on each assignment's
// latest contact, so the full ACTIVE set is classified first and paginated
// in memory afterward — the returned pagination.total reflects the actual
// attention result set, not the total ACTIVE assignment count.
router.get('/follow-ups/attention', asyncHandler(async (req, res) => {
  const attention = await computeAttentionForLeader(req.leaderPersonId!);
  const { page, pageSize, skip, take } = parsePagination(req);

  const pageItems = attention.slice(skip, skip + take).map((i) => ({
    followUpAssignmentId: i.followUpAssignmentId,
    personId: i.personId,
    name: i.name,
    reason: i.reason,
    lastContactedAt: i.lastContactedAt,
    nextFollowUpDate: i.nextFollowUpDate,
  }));

  res.json(paginatedResult(pageItems, attention.length, page, pageSize));
}));

const scopedPeopleQuerySchema = z.object({
  contextType: z.enum(['COMMUNITY', 'GEOGRAPHY']),
  contextId: z.string().min(1),
  search: z.string().trim().max(200).optional(),
});

// GET /api/leader/scoped-people — lets the create-follow-up UI search for a
// Person to follow, but ONLY within the Leader's own exact active
// RoleAssignment scope (never an arbitrary Person, and never a scope the
// Leader doesn't hold) — this is the read-side counterpart of the same
// authorization check enforced again server-side on POST /follow-ups below.
router.get('/scoped-people', asyncHandler(async (req, res) => {
  const parsed = scopedPeopleQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'contextType and contextId are required.' });
  }
  const { contextType, contextId, search } = parsed.data;

  const role = await findActiveScopedRole(req.leaderPersonId!, contextType, contextId);
  if (!role) {
    return res.status(403).json({ error: 'You do not have an active scoped leader role for this exact context.' });
  }

  const searchFilter = search
    ? { OR: [{ name: { contains: search, mode: 'insensitive' as const } }, { whatsappNumber: { contains: search } }] }
    : {};

  const items = await prisma.person.findMany({
    where:
      contextType === 'COMMUNITY'
        ? { communityMemberships: { some: { communityId: contextId, status: 'ACTIVE' } }, ...searchFilter }
        : { geographicAssignment: { geographyId: contextId, status: 'ACTIVE' }, ...searchFilter },
    select: { id: true, name: true, whatsappNumber: true },
    take: 20,
    orderBy: { name: 'asc' },
  });

  res.json({ items });
}));

const createFollowUpSchema = z.object({
  followedPersonId: z.string().min(1),
  contextType: z.enum(['COMMUNITY', 'GEOGRAPHY']),
  contextId: z.string().min(1),
});

// POST /api/leader/follow-ups — the acting Leader is ALWAYS the follower;
// followerId is never accepted from the client body, only derived from the
// authenticated session (req.leaderPersonId).
router.post('/follow-ups', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = createFollowUpSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid follow-up request.' });
  }
  const { followedPersonId, contextType, contextId } = parsed.data;
  const followerId = req.leaderPersonId!;

  if (followedPersonId === followerId) {
    return res.status(400).json({ error: 'A Person cannot follow themselves.' });
  }

  const role = await findActiveScopedRole(followerId, contextType, contextId);
  if (!role) {
    return res.status(403).json({ error: 'You do not have an active scoped leader role for this exact context.' });
  }

  const [followedPerson, targetExists] = await Promise.all([
    prisma.person.findUnique({ where: { id: followedPersonId } }),
    contextTargetExists(contextType, contextId),
  ]);
  if (!followedPerson) return res.status(400).json({ error: 'Followed Person not found.' });
  if (!targetExists) {
    return res.status(400).json({ error: contextType === 'COMMUNITY' ? 'Community not found.' : 'Geography not found.' });
  }

  const belongs = await personBelongsToContext(followedPersonId, contextType, contextId);
  if (!belongs) {
    return res
      .status(400)
      .json({ error: 'This person does not currently belong to your exact assigned scope.' });
  }

  let created;
  try {
    created = await prisma.followUpAssignment.create({
      data: { followerId, followedPersonId, contextType, contextId, assignedByUserId: req.user!.id },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return res.status(409).json({ error: 'You already have an active follow-up assignment with this person.' });
    }
    throw err;
  }

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'FOLLOW_UP_ASSIGNMENT_CREATED',
    targetType: 'FollowUpAssignment',
    targetId: created.id,
    metadata: { followerId, followedPersonId, contextType, contextId },
  });

  res.status(201).json(created);
}));

// GET /api/leader/follow-ups/:id/contacts — a Leader may view contact
// history only for their own assignment. Uses 404 (not 403) for a
// non-owned assignment, so the response never confirms whether the id
// belongs to some other Leader at all.
router.get('/follow-ups/:id/contacts', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const assignment = await prisma.followUpAssignment.findUnique({ where: { id } });
  if (!assignment || assignment.followerId !== req.leaderPersonId) {
    return res.status(404).json({ error: 'Follow-up assignment not found.' });
  }
  const contacts = await prisma.followUpContact.findMany({
    where: { followUpAssignmentId: id },
    orderBy: { contactedAt: 'desc' },
  });
  res.json({ items: contacts });
}));

const contactSchema = z.object({
  wellbeingStatus: z.enum(['GOOD', 'NEEDS_ATTENTION', 'EMERGENCY', 'UNABLE_TO_REACH']),
  note: z.string().trim().max(2000).optional(),
  nextFollowUpDate: z.string().datetime().optional().or(z.literal('').transform(() => undefined)),
});

router.post('/follow-ups/:id/contacts', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid contact.' });
  }

  const assignment = await prisma.followUpAssignment.findUnique({ where: { id } });
  if (!assignment || assignment.followerId !== req.leaderPersonId) {
    return res.status(404).json({ error: 'Follow-up assignment not found.' });
  }
  if (assignment.status !== 'ACTIVE') {
    return res.status(409).json({ error: 'This follow-up assignment is closed.' });
  }

  const created = await prisma.followUpContact.create({
    data: {
      followUpAssignmentId: id,
      wellbeingStatus: parsed.data.wellbeingStatus,
      note: parsed.data.note ?? null,
      nextFollowUpDate: parsed.data.nextFollowUpDate ? new Date(parsed.data.nextFollowUpDate) : null,
      // loggedByUserId is always the authenticated User — never accepted
      // from the client body, so it can never be spoofed.
      loggedByUserId: req.user!.id,
    },
  });

  res.status(201).json(created);
}));

const closeSchema = z.object({ closeReason: z.string().trim().max(1000).optional() });

router.post('/follow-ups/:id/close', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const parsed = closeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request.' });
  }

  const assignment = await prisma.followUpAssignment.findUnique({ where: { id } });
  if (!assignment || assignment.followerId !== req.leaderPersonId) {
    return res.status(404).json({ error: 'Follow-up assignment not found.' });
  }
  if (assignment.status !== 'ACTIVE') {
    return res.status(409).json({ error: 'This follow-up assignment is already closed.' });
  }

  const updated = await prisma.followUpAssignment.update({
    where: { id },
    data: { status: 'CLOSED', closedAt: new Date(), closedByUserId: req.user!.id, closeReason: parsed.data.closeReason ?? null },
  });

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'FOLLOW_UP_CLOSED',
    targetType: 'FollowUpAssignment',
    targetId: id,
  });

  res.json(updated);
}));

const reassignSchema = z.object({ newFollowerId: z.string().min(1), closeReason: z.string().trim().max(1000).optional() });

// POST /api/leader/follow-ups/:id/reassign — the currently assigned
// follower may hand their own assignment to another scoped Leader who
// already holds an active RoleAssignment for the exact same context. Atomic:
// close old + create new in one transaction, so a failure never leaves a
// partial reassignment behind.
router.post('/follow-ups/:id/reassign', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const parsed = reassignSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'newFollowerId is required.' });
  }
  const { newFollowerId, closeReason } = parsed.data;

  const current = await prisma.followUpAssignment.findUnique({ where: { id } });
  if (!current || current.followerId !== req.leaderPersonId) {
    return res.status(404).json({ error: 'Follow-up assignment not found.' });
  }
  if (current.status !== 'ACTIVE') {
    return res.status(409).json({ error: 'This follow-up assignment is closed.' });
  }
  if (newFollowerId === current.followedPersonId) {
    return res.status(400).json({ error: 'A Person cannot follow themselves.' });
  }

  const newFollower = await prisma.person.findUnique({ where: { id: newFollowerId } });
  if (!newFollower) {
    return res.status(400).json({ error: 'New follower Person not found.' });
  }
  const newFollowerRole = await findActiveScopedRole(newFollowerId, current.contextType, current.contextId);
  if (!newFollowerRole) {
    return res.status(400).json({ error: 'The new follower does not have an active scoped leader role for this exact context.' });
  }

  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      await tx.followUpAssignment.update({
        where: { id },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          closedByUserId: req.user!.id,
          closeReason: closeReason ?? 'Reassigned',
        },
      });
      return tx.followUpAssignment.create({
        data: {
          followerId: newFollowerId,
          followedPersonId: current.followedPersonId,
          contextType: current.contextType,
          contextId: current.contextId,
          assignedByUserId: req.user!.id,
        },
      });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return res.status(409).json({ error: 'The new follower already has an active follow-up with this person.' });
    }
    throw err;
  }

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'FOLLOW_UP_REASSIGNED',
    targetType: 'FollowUpAssignment',
    targetId: id,
    metadata: { newAssignmentId: created.id, newFollowerId },
  });

  res.json(created);
}));

export default router;
