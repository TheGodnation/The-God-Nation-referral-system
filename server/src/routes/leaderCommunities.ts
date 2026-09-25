import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { requireCsrf } from '../lib/csrf';
import { recordAudit } from '../lib/audit';
import { communityModerationLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import { requireLinkedPerson, contextTargetExists, isCommunityAdministrator } from '../lib/leadership';
import { normalizeToE164 } from '../lib/phone';

const router = Router();

// Phase 3M.8A — Community Administrator membership management. Every route
// here requires an authenticated Leader whose User is linked to a Person
// (requireLinkedPerson), exactly like leaderFollowUps.ts/leaderLeadershipProposals.ts.
// Admin never needs these — Admin's own membership management stays in
// adminPeople.ts, unchanged.
router.use(requireAuth, requireRole('LEADER'), requireLinkedPerson);

const addMemberSchema = z.object({ whatsappNumber: z.string().min(1) });

// POST /api/leader/communities/:communityId/members — adds an EXISTING
// Person (looked up by their own WhatsApp number, the app's identity key —
// see the Person model's own schema comment) to this exact Community.
// Deliberately not a free-text/fuzzy search across all Persons: that would
// let any Community Administrator browse the names of people anywhere on
// the platform they have no relationship to. A Leader must already know
// the person's WhatsApp number, exactly like every other "look this person
// up" flow already in the app (registration matching, member login).
router.post(
  '/communities/:communityId/members',
  communityModerationLimiter,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const { communityId } = req.params;

    if (!(await contextTargetExists('COMMUNITY', communityId))) {
      return res.status(404).json({ error: 'Community not found.' });
    }

    const actorPersonId = req.leaderPersonId!;
    if (!(await isCommunityAdministrator(actorPersonId, communityId))) {
      return res.status(403).json({ error: 'You do not have an active scoped leader role for this exact Community.' });
    }

    const parsed = addMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'A WhatsApp number is required.' });
    }

    const normalized = normalizeToE164(parsed.data.whatsappNumber);
    if (!normalized) {
      return res.status(400).json({ error: 'Please enter a valid WhatsApp number.' });
    }

    const person = await prisma.person.findUnique({ where: { whatsappNumber: normalized } });
    if (!person) {
      return res.status(404).json({ error: 'No person was found with that WhatsApp number.' });
    }

    const existing = await prisma.communityMembership.findUnique({
      where: { personId_communityId: { personId: person.id, communityId } },
    });
    if (existing?.status === 'ACTIVE') {
      return res.status(409).json({ error: 'This person is already an active member of this Community.' });
    }

    // Reactivating an existing (inactive) row rather than creating a
    // duplicate — same convention as the Admin equivalent in adminPeople.ts.
    const membership = existing
      ? await prisma.communityMembership.update({
          where: { id: existing.id },
          data: { status: 'ACTIVE', joinedAt: new Date() },
        })
      : await prisma.communityMembership.create({
          data: { personId: person.id, communityId },
        });

    await recordAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'COMMUNITY_MEMBER_ADDED_BY_ADMINISTRATOR',
      targetType: 'CommunityMembership',
      targetId: membership.id,
      metadata: { communityId, personId: person.id, addedByPersonId: actorPersonId },
    });

    res.status(201).json({ ...membership, person: { id: person.id, name: person.name } });
  }),
);

const memberStatusSchema = z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) });

// PATCH /api/leader/communities/:communityId/members/:personId — a Community
// Administrator removes (INACTIVE) or reinstates (ACTIVE) an ordinary
// member of this exact Community. Addressed by (communityId, personId) —
// the same compound key CommunityMembership is already uniquely indexed
// on — so the Leader-facing UI never needs to know the internal membership
// row id, only the personId it already has from GET /api/leader/roster.
router.patch(
  '/communities/:communityId/members/:personId',
  communityModerationLimiter,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const { communityId, personId } = req.params;

    if (!(await contextTargetExists('COMMUNITY', communityId))) {
      return res.status(404).json({ error: 'Community not found.' });
    }

    const actorPersonId = req.leaderPersonId!;
    if (!(await isCommunityAdministrator(actorPersonId, communityId))) {
      return res.status(403).json({ error: 'You do not have an active scoped leader role for this exact Community.' });
    }

    const parsed = memberStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'A valid status is required.' });
    }

    // IDOR prevention: looked up by the compound (personId, communityId)
    // key, so a membership belonging to a different Community can never be
    // modified through this exact Community's route, even if its id were
    // somehow guessed.
    const membership = await prisma.communityMembership.findUnique({
      where: { personId_communityId: { personId, communityId } },
    });
    if (!membership) {
      return res.status(404).json({ error: 'This person is not a member of this Community.' });
    }

    const updated = await prisma.communityMembership.update({
      where: { id: membership.id },
      data: { status: parsed.data.status },
    });

    await recordAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action:
        parsed.data.status === 'INACTIVE'
          ? 'COMMUNITY_MEMBER_REMOVED_BY_ADMINISTRATOR'
          : 'COMMUNITY_MEMBER_REINSTATED_BY_ADMINISTRATOR',
      targetType: 'CommunityMembership',
      targetId: updated.id,
      metadata: { communityId, personId, actedByPersonId: actorPersonId },
    });

    res.json(updated);
  }),
);

export default router;
