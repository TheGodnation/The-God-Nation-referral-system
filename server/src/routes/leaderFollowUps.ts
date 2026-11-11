import { recordWhatsAppStop } from '../lib/whatsappConsent';
import { followBlock, followBlockMessage } from '../lib/followRules';
import { communityNameFor, wantsFrench } from '../lib/communityName';
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
import { getOrCreateFollowUpConversation } from '../lib/followUpConversation';
import { followUpCardsFor, CONTACT_DAYS_PER_WEEK } from '../lib/followUpCard';
import { getOrCreatePrivateConversation } from '../lib/privateMessaging';
import { assemblyHealth } from '../lib/assemblyHealth';
import { handOverPeople, isAway, leaderLoads, shareWithLeader } from '../lib/followUpShare';

const router = Router();

// Every route here requires an authenticated Leader whose User is linked to
// a Person (see requireLinkedPerson) — an Admin never needs this and never
// hits these routes; Admin-side Phase 3D actions live in adminLeadership.ts.
router.use(requireAuth, requireRole('LEADER'), requireLinkedPerson);

// GET /api/leader/role-assignments — the acting Leader's OWN active scoped
// roles. Community-scoped only since Geography Retirement Step 5B removed
// RoleAssignment.geographyId entirely. Shared with other, non-Follow-Up
// consumers (MyMembers.tsx, TrainingProgress.tsx, etc.) — it's what gates
// whether "My Follow-Up" shows at all, and supplies the scope options the
// create-follow-up form offers.
router.get('/role-assignments', asyncHandler(async (req, res) => {
  const items = await prisma.roleAssignment.findMany({
    where: { personId: req.leaderPersonId, roleType: 'SCOPED_LEADER', status: 'ACTIVE' },
    include: {
      community: { select: { id: true, name: true } },
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

// GET /api/leader/my-people — "Today" for a leader: each person they follow,
// as a follow-up card, the ones who need them most first. Members never see
// their own card; this is for their leaders only.
router.get('/my-people', asyncHandler(async (req, res) => {
  const [items, me] = await Promise.all([
    followUpCardsFor(req.leaderPersonId!),
    prisma.person.findUnique({ where: { id: req.leaderPersonId! }, select: { awayUntil: true } }),
  ]);
  res.json({
    away: isAway(me?.awayUntil) ? { until: me!.awayUntil } : null,
    contactTarget: CONTACT_DAYS_PER_WEEK,
    total: items.length,
    needingAttention: items.filter((c) => c.flags.length > 0).length,
    items,
  });
}));

// GET /api/leader/assembly-health — how the assemblies I lead, and the ones below them, are doing.
router.get('/assembly-health', asyncHandler(async (req, res) => {
  const roles = await prisma.roleAssignment.findMany({ where: { personId: req.leaderPersonId, status: 'ACTIVE', communityId: { not: null } }, select: { communityId: true } });
  const mineIds = new Set(roles.map((r) => r.communityId as string));
  if (mineIds.size === 0) return res.json({ items: [] });
  const all = await assemblyHealth();
  const parentOf = new Map(all.map((r) => [r.id, r.parentId]));
  const inMySubtree = (id: string) => {
    for (let cur: string | null | undefined = id, i = 0; cur && i < 50; cur = parentOf.get(cur), i += 1) if (mineIds.has(cur)) return true;
    return false;
  };
  res.json({ items: all.filter((r) => inMySubtree(r.id)) });
}));

// PUT /api/leader/my-people/away — "I am away until <date>" (or back now: until null).
// While away, new people are not given to this leader.
router.put('/my-people/away', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = z.object({ until: z.string().datetime().nullable() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'until must be a date, or null to say you are back.' });
  const until = parsed.data.until ? new Date(parsed.data.until) : null;
  if (until && (until.getTime() <= Date.now() || until.getTime() > Date.now() + 366 * 24 * 60 * 60 * 1000)) {
    return res.status(400).json({ error: 'Choose a date in the future, within a year.' });
  }
  await prisma.person.update({ where: { id: req.leaderPersonId! }, data: { awayUntil: until } });
  res.json({ away: until ? { until } : null });
}));

// GET /api/leader/my-people/colleagues — the other leaders of the assemblies I lead, with their load.
router.get('/my-people/colleagues', asyncHandler(async (req, res) => {
  const roles = await prisma.roleAssignment.findMany({
    where: { personId: req.leaderPersonId, status: 'ACTIVE', communityId: { not: null } },
    select: { community: { select: { id: true, name: true, nameFr: true } } },
  });
  const items = [];
  for (const r of roles) {
    if (!r.community) continue;
    const leaders = (await leaderLoads(r.community.id)).filter((l) => l.personId !== req.leaderPersonId);
    items.push({ communityId: r.community.id, communityName: communityNameFor(r.community, wantsFrench(req)), leaders });
  }
  res.json({ items });
}));

// POST /api/leader/my-people/:personId/share — share one of my people with
// another leader of the same assembly (we both follow them), or hand them over
// (they go to the other leader, with the notes and the chat).
router.post('/my-people/:personId/share', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = z.object({ toLeaderPersonId: z.string().min(1), mode: z.enum(['share', 'handover']) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Choose a leader and whether to share or hand over.' });
  const personId = String(req.params.personId);
  const mine = await prisma.followUpAssignment.findFirst({
    where: { followerId: req.leaderPersonId, followedPersonId: personId, status: 'ACTIVE' },
  });
  if (!mine) return res.status(403).json({ error: 'This person is not one of your people.' });
  const { toLeaderPersonId, mode } = parsed.data;
  if (toLeaderPersonId === req.leaderPersonId) return res.status(400).json({ error: 'Choose another leader.' });
  const colleague = await findActiveScopedRole(toLeaderPersonId, 'COMMUNITY', mine.contextId);
  if (!colleague) return res.status(400).json({ error: 'That person is not a leader of this assembly.' });

  if (mode === 'share') {
    const r = await shareWithLeader({ personId, toLeaderId: toLeaderPersonId, communityId: mine.contextId, actorUserId: req.user!.id });
    return res.json({ mode, done: true, alreadyFollowing: !r.created });
  }
  const r = await handOverPeople({ fromLeaderId: req.leaderPersonId!, communityId: mine.contextId, toLeaderId: toLeaderPersonId, onlyPersonId: personId, actorUserId: req.user!.id });
  res.json({ mode, done: r.moved > 0 });
}));

// POST /api/leader/my-people/:personId/chat — opens (or creates) the private
// chat with one of my people, so a leader can write, send a voice note, a
// photo or a file exactly as in any private chat. Only for a person the
// leader is actually following.
router.post('/my-people/:personId/chat', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const personId = String(req.params.personId);
  const mine = await prisma.followUpAssignment.findFirst({
    where: { followerId: req.leaderPersonId, followedPersonId: personId, status: 'ACTIVE' },
    select: { id: true },
  });
  if (!mine) return res.status(403).json({ error: 'This person is not one of your people.' });
  const conversation = await getOrCreatePrivateConversation(personId, { type: 'PERSON', personId: req.leaderPersonId! });
  res.json({ conversationId: conversation.id });
}));

const scopedPeopleQuerySchema = z.object({
  contextType: z.enum(['COMMUNITY']),
  contextId: z.string().min(1),
  search: z.string().trim().max(200).optional(),
});

// GET /api/leader/scoped-people — lets the create-follow-up UI search for a
// Person to follow, but ONLY within the Leader's own exact active
// RoleAssignment scope (never an arbitrary Person, and never a scope the
// Leader doesn't hold) — this is the read-side counterpart of the same
// authorization check enforced again server-side on POST /follow-ups below.
// Geography Retirement Step 5A: contextType now accepts only 'COMMUNITY' —
// a GEOGRAPHY request is rejected by scopedPeopleQuerySchema itself.
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
    where: { communityMemberships: { some: { communityId: contextId, status: 'ACTIVE' } }, ...searchFilter },
    select: { id: true, name: true, whatsappNumber: true },
    take: 20,
    orderBy: { name: 'asc' },
  });

  res.json({ items });
}));

// Geography Retirement Step 5A: contextType now accepts only 'COMMUNITY' —
// a GEOGRAPHY create request is rejected by createFollowUpSchema itself.
const createFollowUpSchema = z.object({
  followedPersonId: z.string().min(1),
  contextType: z.enum(['COMMUNITY']),
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
  // The central admin follows up the leaders, never the other way round; leaders only by the central admin and the representatives.
  const block = await followBlock(followerId, followedPersonId);
  if (block) return res.status(400).json({ error: followBlockMessage(block), code: block === 'CENTRAL_ADMIN' ? 'CENTRAL_ADMIN_NOT_FOLLOWED' : 'LEADER_NOT_FOLLOWED_BY_LEADERS' });

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
    return res.status(400).json({ error: 'Community not found.' });
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

// "Opted out": the person asked this leader to stop writing to them on WhatsApp. Recorded, and they are left out of every
// WhatsApp queue from then on (the leader's and the coordinator's).
router.post('/follow-ups/:id/whatsapp-stop', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const assignment = await prisma.followUpAssignment.findUnique({ where: { id } });
  if (!assignment || assignment.followerId !== req.leaderPersonId) {
    return res.status(404).json({ error: 'Follow-up assignment not found.' });
  }
  await recordWhatsAppStop(assignment.followedPersonId);
  res.json({ ok: true });
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
      // where it is, attached to the now-closed old assignment, never
      // merged or transferred.
      await tx.followUpConversation.create({ data: { followUpAssignmentId: newAssignment.id } });
      return newAssignment;
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
