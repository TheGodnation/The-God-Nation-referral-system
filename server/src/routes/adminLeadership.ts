import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { requireCsrf } from '../lib/csrf';
import { parsePagination, paginatedResult } from '../lib/pagination';
import { recordAudit } from '../lib/audit';
import { leadershipMutationLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import { findActiveScopedRole, contextTargetExists } from '../lib/leadership';
import { getOrCreateFollowUpConversation } from '../lib/followUpConversation';

const router = Router();

router.use(requireAuth, requireRole('ADMIN'));

// ---------------------------------------------------------------------------
// Role Assignments (Phase 3D) — Admin-only. Leaders can never assign
// themselves or anyone else a RoleAssignment.
// ---------------------------------------------------------------------------

const listRoleAssignmentsSchema = z.object({
  personId: z.string().min(1).optional(),
  communityId: z.string().min(1).optional(),
  geographyId: z.string().min(1).optional(),
  status: z.enum(['ACTIVE', 'ENDED']).optional(),
});

router.get('/role-assignments', asyncHandler(async (req, res) => {
  const { page, pageSize, skip, take } = parsePagination(req);
  const q = listRoleAssignmentsSchema.parse(req.query);

  const where: Prisma.RoleAssignmentWhereInput = {
    ...(q.personId ? { personId: q.personId } : {}),
    ...(q.communityId ? { communityId: q.communityId } : {}),
    ...(q.geographyId ? { geographyId: q.geographyId } : {}),
    ...(q.status ? { status: q.status } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.roleAssignment.count({ where }),
    prisma.roleAssignment.findMany({
      where,
      include: {
        person: { select: { id: true, name: true, whatsappNumber: true } },
        community: { select: { id: true, name: true } },
        geography: { select: { id: true, name: true, type: true } },
        assignedBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { assignedAt: 'desc' },
      skip,
      take,
    }),
  ]);

  res.json(paginatedResult(items, total, page, pageSize));
}));

const createRoleAssignmentSchema = z
  .object({
    personId: z.string().min(1),
    roleType: z.literal('SCOPED_LEADER'),
    communityId: z.string().min(1).optional(),
    geographyId: z.string().min(1).optional(),
  })
  .refine((d) => Boolean(d.communityId) !== Boolean(d.geographyId), {
    message: 'Exactly one of communityId or geographyId must be provided.',
  });

router.post('/role-assignments', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = createRoleAssignmentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid role assignment.' });
  }
  const { personId, roleType, communityId, geographyId } = parsed.data;

  const person = await prisma.person.findUnique({ where: { id: personId } });
  if (!person) {
    return res.status(400).json({ error: 'Person not found.' });
  }

  if (communityId) {
    const community = await prisma.community.findUnique({ where: { id: communityId } });
    if (!community) return res.status(400).json({ error: 'Community not found.' });
  } else if (geographyId) {
    const geography = await prisma.geography.findUnique({ where: { id: geographyId } });
    if (!geography) return res.status(400).json({ error: 'Geography not found.' });
  }

  let created;
  try {
    created = await prisma.roleAssignment.create({
      data: {
        personId,
        roleType,
        communityId: communityId ?? null,
        geographyId: geographyId ?? null,
        assignedByUserId: req.user!.id,
      },
    });
  } catch (err) {
    // The partial unique indexes (active person+community / active
    // person+geography) are the final authority — a concurrent duplicate
    // request races against these, and the loser lands here cleanly.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return res.status(409).json({ error: 'An active role assignment already exists for this Person and scope.' });
    }
    throw err;
  }

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'ROLE_ASSIGNMENT_CREATED',
    targetType: 'RoleAssignment',
    targetId: created.id,
    metadata: { personId, roleType, communityId: communityId ?? null, geographyId: geographyId ?? null },
  });

  res.status(201).json(created);
}));

router.patch('/role-assignments/:id/end', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const assignment = await prisma.roleAssignment.findUnique({ where: { id } });
  if (!assignment) {
    return res.status(404).json({ error: 'Role assignment not found.' });
  }
  if (assignment.status === 'ENDED') {
    return res.status(409).json({ error: 'This role assignment has already ended.' });
  }

  const updated = await prisma.roleAssignment.update({
    where: { id },
    data: { status: 'ENDED', endedAt: new Date() },
  });

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'ROLE_ASSIGNMENT_ENDED',
    targetType: 'RoleAssignment',
    targetId: id,
  });

  res.json(updated);
}));

// ---------------------------------------------------------------------------
// Follow-Up oversight (Phase 3D) — Admin sees and may act on every
// FollowUpAssignment globally.
// ---------------------------------------------------------------------------

const listFollowUpsSchema = z.object({
  followerId: z.string().min(1).optional(),
  followedPersonId: z.string().min(1).optional(),
  status: z.enum(['ACTIVE', 'CLOSED']).optional(),
});

router.get('/follow-ups', asyncHandler(async (req, res) => {
  const { page, pageSize, skip, take } = parsePagination(req);
  const q = listFollowUpsSchema.parse(req.query);

  const where: Prisma.FollowUpAssignmentWhereInput = {
    ...(q.followerId ? { followerId: q.followerId } : {}),
    ...(q.followedPersonId ? { followedPersonId: q.followedPersonId } : {}),
    ...(q.status ? { status: q.status } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.followUpAssignment.count({ where }),
    prisma.followUpAssignment.findMany({
      where,
      include: {
        follower: { select: { id: true, name: true } },
        followedPerson: { select: { id: true, name: true } },
        assignedBy: { select: { id: true, name: true, email: true } },
        closedBy: { select: { id: true, name: true, email: true } },
        contacts: { orderBy: { contactedAt: 'desc' }, take: 1 },
      },
      orderBy: { assignedAt: 'desc' },
      skip,
      take,
    }),
  ]);

  res.json(paginatedResult(items, total, page, pageSize));
}));

const createFollowUpSchema = z.object({
  followerId: z.string().min(1),
  followedPersonId: z.string().min(1),
  contextType: z.enum(['COMMUNITY', 'GEOGRAPHY']),
  contextId: z.string().min(1),
});

// POST /api/admin/follow-ups — Admin may create a follow-up assignment
// globally, choosing any follower/followed Person/context. Unlike the
// Leader-created path below, this does not require the follower to already
// hold a matching RoleAssignment — Admin has full override authority here.
router.post('/follow-ups', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = createFollowUpSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid follow-up assignment.' });
  }
  const { followerId, followedPersonId, contextType, contextId } = parsed.data;

  if (followerId === followedPersonId) {
    return res.status(400).json({ error: 'A Person cannot follow themselves.' });
  }

  const [follower, followedPerson, targetExists] = await Promise.all([
    prisma.person.findUnique({ where: { id: followerId } }),
    prisma.person.findUnique({ where: { id: followedPersonId } }),
    contextTargetExists(contextType, contextId),
  ]);
  if (!follower) return res.status(400).json({ error: 'Follower Person not found.' });
  if (!followedPerson) return res.status(400).json({ error: 'Followed Person not found.' });
  if (!targetExists) {
    return res.status(400).json({ error: contextType === 'COMMUNITY' ? 'Community not found.' : 'Geography not found.' });
  }

  let created;
  try {
    created = await prisma.followUpAssignment.create({
      data: { followerId, followedPersonId, contextType, contextId, assignedByUserId: req.user!.id },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return res.status(409).json({ error: 'An active follow-up assignment already exists for this follower and person.' });
    }
    throw err;
  }

  // Phase 3M.2: every FollowUpAssignment gets its own conversation eagerly.
  await getOrCreateFollowUpConversation(created.id);

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

const reassignSchema = z.object({ newFollowerId: z.string().min(1), closeReason: z.string().trim().max(1000).optional() });

// POST /api/admin/follow-ups/:id/reassign — atomic: close old, create new,
// in one transaction. If anything fails, the old assignment stays active.
router.post('/follow-ups/:id/reassign', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const parsed = reassignSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'newFollowerId is required.' });
  }
  const { newFollowerId, closeReason } = parsed.data;

  const current = await prisma.followUpAssignment.findUnique({ where: { id } });
  if (!current || current.status !== 'ACTIVE') {
    return res.status(404).json({ error: 'Active follow-up assignment not found.' });
  }

  const newFollower = await prisma.person.findUnique({ where: { id: newFollowerId } });
  if (!newFollower) {
    return res.status(400).json({ error: 'New follower Person not found.' });
  }
  const newFollowerRole = await findActiveScopedRole(newFollowerId, current.contextType, current.contextId);
  if (!newFollowerRole) {
    return res.status(400).json({ error: 'The new follower does not have an active scoped leader role for this exact context.' });
  }
  if (newFollowerId === current.followedPersonId) {
    return res.status(400).json({ error: 'A Person cannot follow themselves.' });
  }

  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      await tx.followUpAssignment.update({
        where: { id },
        data: { status: 'CLOSED', closedAt: new Date(), closedByUserId: req.user!.id, closeReason: closeReason ?? 'Reassigned' },
      });
      const newAssignment = await tx.followUpAssignment.create({
        data: {
          followerId: newFollowerId,
          followedPersonId: current.followedPersonId,
          contextType: current.contextType,
          contextId: current.contextId,
          assignedByUserId: req.user!.id,
        },
      });
      // Phase 3M.2: the new assignment gets its own, independent
      // conversation — the old assignment's conversation stays exactly
      // where it is, attached to the now-closed old assignment.
      await tx.followUpConversation.create({ data: { followUpAssignmentId: newAssignment.id } });
      return newAssignment;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // Transaction rolled back automatically — the old assignment is still active.
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

const closeSchema = z.object({ closeReason: z.string().trim().max(1000).optional() });

router.post('/follow-ups/:id/close', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const parsed = closeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request.' });
  }

  const assignment = await prisma.followUpAssignment.findUnique({ where: { id } });
  if (!assignment || assignment.status !== 'ACTIVE') {
    return res.status(404).json({ error: 'Active follow-up assignment not found.' });
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

router.get('/follow-ups/:id/contacts', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const assignment = await prisma.followUpAssignment.findUnique({ where: { id } });
  if (!assignment) {
    return res.status(404).json({ error: 'Follow-up assignment not found.' });
  }
  const contacts = await prisma.followUpContact.findMany({
    where: { followUpAssignmentId: id },
    include: { loggedBy: { select: { id: true, name: true } } },
    orderBy: { contactedAt: 'desc' },
  });
  res.json({ items: contacts });
}));

const contactSchema = z.object({
  wellbeingStatus: z.enum(['GOOD', 'NEEDS_ATTENTION', 'EMERGENCY', 'UNABLE_TO_REACH']),
  note: z.string().trim().max(2000).optional(),
  nextFollowUpDate: z.string().datetime().optional().or(z.literal('').transform(() => undefined)),
  contactedAt: z.string().datetime().optional(),
});

// POST /api/admin/follow-ups/:id/contacts — Admin may log/override a
// contact on any assignment. Still requires the assignment to be ACTIVE:
// a closed relationship does not accumulate new contacts — reopening means
// creating a new assignment (via /reassign or a fresh POST /follow-ups),
// not resurrecting a closed one.
router.post('/follow-ups/:id/contacts', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid contact.' });
  }

  const assignment = await prisma.followUpAssignment.findUnique({ where: { id } });
  if (!assignment || assignment.status !== 'ACTIVE') {
    return res.status(404).json({ error: 'Active follow-up assignment not found.' });
  }

  const created = await prisma.followUpContact.create({
    data: {
      followUpAssignmentId: id,
      wellbeingStatus: parsed.data.wellbeingStatus,
      note: parsed.data.note ?? null,
      nextFollowUpDate: parsed.data.nextFollowUpDate ? new Date(parsed.data.nextFollowUpDate) : null,
      contactedAt: parsed.data.contactedAt ? new Date(parsed.data.contactedAt) : new Date(),
      loggedByUserId: req.user!.id,
    },
  });

  res.status(201).json(created);
}));

export default router;
