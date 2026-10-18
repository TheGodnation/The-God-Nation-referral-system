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
import { computeAttentionAcrossNetwork } from '../lib/followUpAttention';
import { notifyFollowUpAssigned, notifyRoleAssigned } from '../lib/notifications';

const router = Router();

router.use(requireAuth, requireRole('ADMIN'));

// ---------------------------------------------------------------------------
// Role Assignments (Phase 3D) — Admin-only. Leaders can never assign
// themselves or anyone else a RoleAssignment.
// ---------------------------------------------------------------------------

const listRoleAssignmentsSchema = z.object({
  personId: z.string().min(1).optional(),
  communityId: z.string().min(1).optional(),
  status: z.enum(['ACTIVE', 'ENDED']).optional(),
});

router.get('/role-assignments', asyncHandler(async (req, res) => {
  const { page, pageSize, skip, take } = parsePagination(req);
  const q = listRoleAssignmentsSchema.parse(req.query);

  const where: Prisma.RoleAssignmentWhereInput = {
    ...(q.personId ? { personId: q.personId } : {}),
    ...(q.communityId ? { communityId: q.communityId } : {}),
    ...(q.status ? { status: q.status } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.roleAssignment.count({ where }),
    prisma.roleAssignment.findMany({
      where,
      include: {
        person: { select: { id: true, name: true, whatsappNumber: true } },
        community: { select: { id: true, name: true } },
        assignedBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { assignedAt: 'desc' },
      skip,
      take,
    }),
  ]);

  res.json(paginatedResult(items, total, page, pageSize));
}));

// Geography Retirement Step 5B: communityId is now the only scope a
// SCOPED_LEADER assignment can target — a stray geographyId field is
// silently stripped by Zod's default non-strict parsing, same convention
// established for AnnouncementTarget in Step 4.
const createRoleAssignmentSchema = z.object({
  personId: z.string().min(1),
  roleType: z.literal('SCOPED_LEADER'),
  communityId: z.string().min(1),
});

router.post('/role-assignments', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = createRoleAssignmentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid role assignment.' });
  }
  const { personId, roleType, communityId } = parsed.data;

  const person = await prisma.person.findUnique({ where: { id: personId } });
  if (!person) {
    return res.status(400).json({ error: 'Person not found.' });
  }

  const community = await prisma.community.findUnique({ where: { id: communityId } });
  if (!community) return res.status(400).json({ error: 'Community not found.' });

  let created;
  try {
    created = await prisma.roleAssignment.create({
      data: {
        personId,
        roleType,
        communityId,
        assignedByUserId: req.user!.id,
      },
    });
  } catch (err) {
    // The partial unique index (active person+community) is the final
    // authority — a concurrent duplicate request races against it, and the
    // loser lands here cleanly.
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
    metadata: { personId, roleType, communityId },
  });

  await notifyRoleAssigned(created);

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

// GET /api/admin/follow-ups/attention — Central Authority Follow-Up
// Attention. A derived, read-only, network-wide view of every ACTIVE
// FollowUpAssignment (across every Leader and every Community) that
// currently needs attention — see lib/followUpAttention.ts's
// computeAttentionAcrossNetwork, which reuses the exact same classification
// rule and priority ordering as the Leader's own
// GET /api/leader/follow-ups/attention rather than a second rules engine.
// Placed before the '/follow-ups/:id/...' routes below only for reading
// order — 'attention' can never collide with those, since none of them are
// a bare 'GET /follow-ups/:id'. Only the minimum fields a Central Authority
// oversight view needs are returned: no WhatsApp number, email, address,
// DOB, photo, contact note, full contact history, or training/assessment
// data — exactly like the Leader's own attention response, plus the
// follower and Community identification a network-wide view requires.
// Classification depends on each assignment's latest contact, so the full
// ACTIVE set is classified first and paginated in memory afterward — the
// returned pagination.total reflects the actual attention result set, not
// the total ACTIVE assignment count (same convention as the Leader route).
router.get('/follow-ups/attention', asyncHandler(async (req, res) => {
  const attention = await computeAttentionAcrossNetwork();
  const { page, pageSize, skip, take } = parsePagination(req);

  const pageItems = attention.slice(skip, skip + take).map((i) => ({
    followUpAssignmentId: i.followUpAssignmentId,
    followerPersonId: i.followerPersonId,
    followerName: i.followerName,
    personId: i.personId,
    name: i.name,
    communityId: i.communityId,
    communityName: i.communityName,
    reason: i.reason,
    lastContactedAt: i.lastContactedAt,
    nextFollowUpDate: i.nextFollowUpDate,
  }));

  res.json(paginatedResult(pageItems, attention.length, page, pageSize));
}));

// Geography Retirement Step 5A: contextType now accepts only 'COMMUNITY' —
// a GEOGRAPHY create request is rejected by createFollowUpSchema itself.
const createFollowUpSchema = z.object({
  followerId: z.string().min(1),
  followedPersonId: z.string().min(1),
  contextType: z.enum(['COMMUNITY']),
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
    return res.status(400).json({ error: 'Community not found.' });
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

  await notifyFollowUpAssigned(created);

  res.status(201).json(created);
}));

const bulkDistributeFollowUpsSchema = z.object({
  contextType: z.enum(['COMMUNITY']),
  contextId: z.string().min(1),
  // At least two Leaders to split between — one Leader is just the ordinary
  // single-assignment flow above. Capped generously; a real Community's
  // Leader count is always small in practice.
  followerPersonIds: z.array(z.string().min(1)).min(2).max(50),
});

// POST /api/admin/follow-ups/bulk-distribute — splits every currently
// unfollowed ACTIVE member of a Community roughly evenly across a chosen
// set of that Community's own Leaders, in one action, instead of Admin (or
// each Leader) creating a hundred individual follow-ups by hand. Every
// Leader passed in must hold an ACTIVE, EXACT-match SCOPED_LEADER role for
// this Community — the same authorization already required of a Leader
// creating their own follow-up (leaderFollowUps.ts) — so this never
// silently hands someone's follow-up list to a person with no real
// standing in that Community. Deliberately touches only people nobody is
// already actively following: it fills the gap, it never reassigns or
// duplicates an existing relationship (use reassign for that, one at a
// time, exactly as before). A Leader never has anyone from the same
// `followerPersonIds` batch assigned to them — Leaders split the group
// between themselves, they don't end up following each other.
router.post('/follow-ups/bulk-distribute', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = bulkDistributeFollowUpsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request.' });
  }
  const { contextType, contextId } = parsed.data;
  const followerPersonIds = Array.from(new Set(parsed.data.followerPersonIds));
  if (followerPersonIds.length < 2) {
    return res.status(400).json({ error: 'Choose at least two Leaders to split between.' });
  }

  const targetExists = await contextTargetExists(contextType, contextId);
  if (!targetExists) {
    return res.status(400).json({ error: 'Community not found.' });
  }

  const roleChecks = await Promise.all(followerPersonIds.map((id) => findActiveScopedRole(id, contextType, contextId)));
  const unqualified = followerPersonIds.filter((_, i) => !roleChecks[i]);
  if (unqualified.length > 0) {
    return res.status(400).json({
      error: 'One or more selected Leaders do not have an active leadership role for this exact Community.',
      unqualifiedPersonIds: unqualified,
    });
  }

  const followerSet = new Set(followerPersonIds);
  const [members, alreadyFollowed] = await Promise.all([
    prisma.communityMembership.findMany({
      where: { communityId: contextId, status: 'ACTIVE' },
      include: { person: { select: { id: true, name: true } } },
      orderBy: { person: { name: 'asc' } },
    }),
    prisma.followUpAssignment.findMany({
      where: { contextType, contextId, status: 'ACTIVE' },
      select: { followedPersonId: true },
    }),
  ]);
  const alreadyFollowedSet = new Set(alreadyFollowed.map((a) => a.followedPersonId));

  // The pool to split: every active member here, except the Leaders doing
  // the following themselves, and anyone already actively followed by
  // anyone (never double-assigned, never silently reassigned).
  const pool = members.map((m) => m.person).filter((p) => !followerSet.has(p.id) && !alreadyFollowedSet.has(p.id));

  if (pool.length === 0) {
    return res.json({
      totalEligible: 0,
      totalAssigned: 0,
      skippedAlreadyFollowed: alreadyFollowedSet.size,
      perLeader: followerPersonIds.map((id) => ({ followerId: id, count: 0 })),
    });
  }

  // Round-robin in a stable (alphabetical-by-name) order — splits as evenly
  // as possible (off by at most one between any two Leaders), and running
  // it again later only ever affects the newly-unfollowed remainder.
  const perLeaderCounts = new Map(followerPersonIds.map((id) => [id, 0]));
  const toCreate = pool.map((person, i) => {
    const followerId = followerPersonIds[i % followerPersonIds.length];
    perLeaderCounts.set(followerId, (perLeaderCounts.get(followerId) ?? 0) + 1);
    return { followerId, followedPersonId: person.id };
  });

  const created = await prisma.$transaction(
    toCreate.map((c) =>
      prisma.followUpAssignment.create({
        data: { followerId: c.followerId, followedPersonId: c.followedPersonId, contextType, contextId, assignedByUserId: req.user!.id },
      }),
    ),
  );

  for (const assignment of created) {
    await getOrCreateFollowUpConversation(assignment.id);
    await notifyFollowUpAssigned(assignment);
  }

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'FOLLOW_UP_BULK_DISTRIBUTED',
    targetType: 'Community',
    targetId: contextId,
    metadata: { followerPersonIds, totalAssigned: created.length },
  });

  res.status(201).json({
    totalEligible: pool.length,
    totalAssigned: created.length,
    skippedAlreadyFollowed: alreadyFollowedSet.size,
    perLeader: followerPersonIds.map((id) => ({ followerId: id, count: perLeaderCounts.get(id) ?? 0 })),
  });
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

  await notifyFollowUpAssigned(created);

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
