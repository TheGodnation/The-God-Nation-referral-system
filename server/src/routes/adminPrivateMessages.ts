import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { requireCsrf } from '../lib/csrf';
import { leadershipMutationLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import { getAllEligibleMemberPersonIds, getCommunityMemberPersonIds, getOrCreatePrivateConversation } from '../lib/privateMessaging';

const router = Router();

// Admin (Central Authority) only — private-conversation INITIATION.
// Ordinary participation (listing/reading/sending/marking-read on an
// already-created conversation, including one an Admin initiated) goes
// through the shared routes/privateMessages.ts surface instead — this file
// only ever creates conversations, per the task's "participant creation
// must be controlled by the authorized conversation creator/organizational
// scope" requirement.
router.use(requireAuth, requireRole('ADMIN'));

const MAX_SELECTED_MEMBERS = 200;

const createSchema = z
  .object({
    scope: z.enum(['ALL_ELIGIBLE', 'SELECTED_MEMBERS', 'SELECTED_COMMUNITY']),
    personIds: z.array(z.string().min(1)).max(MAX_SELECTED_MEMBERS).optional(),
    communityId: z.string().min(1).optional(),
    body: z.string().trim().min(1).max(2000),
  })
  .refine((d) => d.scope !== 'SELECTED_MEMBERS' || (d.personIds && d.personIds.length > 0), {
    message: 'At least one personId is required for the SELECTED_MEMBERS scope.',
  })
  .refine((d) => d.scope !== 'SELECTED_COMMUNITY' || Boolean(d.communityId), {
    message: 'A communityId is required for the SELECTED_COMMUNITY scope.',
  });

// POST /api/admin/private-messages/conversations — resolves the target
// audience server-side from the requested scope (never a client-supplied
// arbitrary Person list beyond SELECTED_MEMBERS' own explicit ids, which are
// still validated to actually exist below), then get-or-creates one
// PrivateConversation PER targeted Person (fan-out — see
// PrivateConversation's own schema comment for why this is not "one row per
// recipient merely to determine audience") and appends the given body as a
// new PrivateMessage in each. initiatorUserId is always req.user!.id, never
// accepted from the body.
router.post('/conversations', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request.' });
  }
  const d = parsed.data;

  let targetPersonIds: string[];
  if (d.scope === 'ALL_ELIGIBLE') {
    targetPersonIds = await getAllEligibleMemberPersonIds();
  } else if (d.scope === 'SELECTED_COMMUNITY') {
    const community = await prisma.community.findUnique({ where: { id: d.communityId! }, select: { id: true } });
    if (!community) return res.status(400).json({ error: 'Community not found.' });
    targetPersonIds = await getCommunityMemberPersonIds(d.communityId!);
  } else {
    const requested = Array.from(new Set(d.personIds!));
    const existingCount = await prisma.person.count({ where: { id: { in: requested } } });
    if (existingCount !== requested.length) {
      return res.status(400).json({ error: 'One or more selected members do not exist.' });
    }
    targetPersonIds = requested;
  }

  if (targetPersonIds.length === 0) {
    return res.status(400).json({ error: 'No eligible recipients were found for this scope.' });
  }

  const initiatorUserId = req.user!.id;
  let conversationsCreated = 0;
  let conversationsReused = 0;

  for (const memberPersonId of targetPersonIds) {
    const existing = await prisma.privateConversation.findUnique({
      where: { memberPersonId_initiatorUserId: { memberPersonId, initiatorUserId } },
      select: { id: true },
    });
    const conversation = await getOrCreatePrivateConversation(memberPersonId, { type: 'USER', userId: initiatorUserId });
    if (existing) conversationsReused += 1;
    else conversationsCreated += 1;

    await prisma.privateMessage.create({
      data: { conversationId: conversation.id, senderUserId: initiatorUserId, body: d.body },
    });
  }

  res.status(201).json({
    targetCount: targetPersonIds.length,
    conversationsCreated,
    conversationsReused,
  });
}));

export default router;
