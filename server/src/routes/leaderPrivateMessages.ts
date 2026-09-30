import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { requireCsrf } from '../lib/csrf';
import { requireLinkedPerson } from '../lib/leadership';
import { leadershipMutationLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import { getLeaderExactCommunityIds, getOrCreatePrivateConversation } from '../lib/privateMessaging';
import { notifyPrivateMessageReceived } from '../lib/notifications';

const router = Router();

// Every route here requires an authenticated Leader whose User is linked to
// a Person (see requireLinkedPerson) — the exact same precondition every
// other Leader-authored messaging surface in this codebase already
// enforces (leaderFollowUps.ts, leaderLeadershipCollaboration.ts, ...).
router.use(requireAuth, requireRole('LEADER'), requireLinkedPerson);

const MAX_SELECTED_MEMBERS = 50;

const createSchema = z.object({
  personIds: z.array(z.string().min(1)).min(1).max(MAX_SELECTED_MEMBERS),
  body: z.string().trim().min(1).max(2000),
});

// POST /api/leader/private-messages/conversations — a Leader may initiate a
// private conversation only with a Person who is an ACTIVE member of a
// Community the Leader currently holds an ACTIVE, EXACT SCOPED_LEADER
// RoleAssignment for (never Geography, never a parent/child/descendant
// Community, never OrganizationalLeadershipRecommendation — see
// getLeaderExactCommunityIds in lib/privateMessaging.ts, which reuses
// RoleAssignment directly rather than any recommendation/proposal record).
// leaderPersonId is always req.leaderPersonId, never accepted from the body.
router.post('/conversations', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request.' });
  }
  const { body } = parsed.data;
  const leaderPersonId = req.leaderPersonId!;
  const requestedPersonIds = Array.from(new Set(parsed.data.personIds));

  if (requestedPersonIds.includes(leaderPersonId)) {
    return res.status(400).json({ error: 'A Leader cannot start a private conversation with themselves.' });
  }

  const leaderCommunityIds = await getLeaderExactCommunityIds(leaderPersonId);
  if (leaderCommunityIds.length === 0) {
    return res.status(403).json({ error: 'You do not have an active Community leadership role.' });
  }

  const eligibleMemberships = await prisma.communityMembership.findMany({
    where: { personId: { in: requestedPersonIds }, status: 'ACTIVE', communityId: { in: leaderCommunityIds } },
    select: { personId: true },
    distinct: ['personId'],
  });
  const eligiblePersonIds = new Set(eligibleMemberships.map((m) => m.personId));
  const ineligible = requestedPersonIds.filter((id) => !eligiblePersonIds.has(id));
  if (ineligible.length > 0) {
    return res.status(403).json({ error: 'One or more selected members do not belong to a Community you lead.' });
  }

  let conversationsCreated = 0;
  let conversationsReused = 0;

  for (const memberPersonId of requestedPersonIds) {
    const existing = await prisma.privateConversation.findUnique({
      where: { memberPersonId_initiatorPersonId: { memberPersonId, initiatorPersonId: leaderPersonId } },
      select: { id: true },
    });
    const conversation = await getOrCreatePrivateConversation(memberPersonId, { type: 'PERSON', personId: leaderPersonId });
    if (existing) conversationsReused += 1;
    else conversationsCreated += 1;

    await prisma.privateMessage.create({
      data: { conversationId: conversation.id, senderPersonId: leaderPersonId, body },
    });
    await notifyPrivateMessageReceived(conversation, { type: 'PERSON', personId: leaderPersonId });
  }

  res.status(201).json({
    targetCount: requestedPersonIds.length,
    conversationsCreated,
    conversationsReused,
  });
}));

export default router;
