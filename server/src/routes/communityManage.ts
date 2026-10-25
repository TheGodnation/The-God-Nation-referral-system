import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireMember } from '../lib/memberAuth';
import { requireCsrf } from '../lib/csrf';
import { asyncHandler } from '../lib/asyncHandler';
import { communityMutationLimiter } from '../lib/rateLimit';
import { isCentralAdminPerson } from '../lib/centralAdmin';
import { contextTargetExists } from '../lib/leadership';
import { recordAudit } from '../lib/audit';
import { profilePhotoPath } from '../lib/profilePhoto';

// ---------------------------------------------------------------------------
// Running an assembly from the app, for the central admin's member profile
// ("National Coordinator"): make a private sub-assembly inside this one, and
// add people to it by name. The admin dashboard has the same powers
// (Communities / People tabs); this is the same thing from the phone.
// ---------------------------------------------------------------------------

const router = Router();
router.use(requireMember);

async function requireCoordinator(req: any, res: any): Promise<string | null> {
  const personId = req.member!.personId as string;
  if (!(await isCentralAdminPerson(personId))) {
    res.status(403).json({ error: 'Only the central admin can do this.', code: 'NOT_ALLOWED' });
    return null;
  }
  if (!(await contextTargetExists('COMMUNITY', req.params.communityId))) {
    res.status(404).json({ error: 'Assembly not found.' });
    return null;
  }
  return personId;
}

const subSchema = z.object({
  name: z.string().trim().min(1, 'Please type a name.').max(200),
  aboutEn: z.string().trim().max(1000).optional(),
});

// POST /api/communities/:communityId/sub-assemblies — a new assembly inside
// this one. It is private: nobody is placed in it automatically; people
// are in it only when added.
router.post('/:communityId/sub-assemblies', communityMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const personId = await requireCoordinator(req, res);
  if (!personId) return;
  const parsed = subSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid name.' });

  const created = await prisma.$transaction(async (tx) => {
    const community = await tx.community.create({
      data: { name: parsed.data.name, parentId: req.params.communityId, autoPlacementEligible: false, aboutEn: parsed.data.aboutEn || null },
    });
    await tx.conversation.create({ data: { communityId: community.id } });
    return community;
  });
  await recordAudit({
    actorId: req.user?.id ?? null,
    action: 'COMMUNITY_CREATED',
    targetType: 'Community',
    targetId: created.id,
    metadata: { name: created.name, parentId: created.parentId, byPersonId: personId, via: 'app' },
  });
  res.status(201).json({ id: created.id, name: created.name });
}));

const searchSchema = z.object({ q: z.string().trim().min(2).max(100) });

// GET /api/communities/:communityId/people-search?q= — find people to add
// (by name, WhatsApp number or sign-in email), saying who is already in.
router.get('/:communityId/people-search', asyncHandler(async (req, res) => {
  const personId = await requireCoordinator(req, res);
  if (!personId) return;
  const parsed = searchSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Type at least 2 letters.' });
  const q = parsed.data.q;
  const people = await prisma.person.findMany({
    where: {
      erasedAt: null,
      deletionRequestedAt: null,
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { whatsappNumber: { contains: q.replace(/\s+/g, '') } },
        { memberAccount: { email: { contains: q, mode: 'insensitive' } } },
      ],
    },
    orderBy: { name: 'asc' },
    take: 20,
    select: {
      id: true,
      name: true,
      photoStorageKey: true,
      photoUpdatedAt: true,
      communityMemberships: { where: { communityId: req.params.communityId, status: 'ACTIVE' }, select: { id: true } },
    },
  });
  res.json({
    items: people.map((p) => ({ id: p.id, name: p.name, photoUrl: profilePhotoPath(p), isMember: p.communityMemberships.length > 0 })),
  });
}));

const addSchema = z.object({ personId: z.string().min(1) });

// POST /api/communities/:communityId/members — add a person (or bring back
// one who had left).
router.post('/:communityId/members', communityMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const actor = await requireCoordinator(req, res);
  if (!actor) return;
  const parsed = addSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'personId is required.' });
  const { communityId } = req.params;

  const person = await prisma.person.findUnique({ where: { id: parsed.data.personId }, select: { id: true, name: true, erasedAt: true, deletionRequestedAt: true } });
  if (!person || person.erasedAt || person.deletionRequestedAt) return res.status(404).json({ error: 'Person not found.' });

  const existing = await prisma.communityMembership.findUnique({ where: { personId_communityId: { personId: person.id, communityId } } });
  if (existing?.status === 'ACTIVE') return res.status(409).json({ error: `${person.name} is already in this assembly.`, code: 'ALREADY_MEMBER' });

  if (existing) {
    await prisma.communityMembership.update({ where: { id: existing.id }, data: { status: 'ACTIVE', joinedAt: new Date() } });
  } else {
    await prisma.communityMembership.create({ data: { personId: person.id, communityId } });
  }
  await recordAudit({
    actorId: req.user?.id ?? null,
    action: 'COMMUNITY_MEMBERSHIP_ADDED',
    targetType: 'Person',
    targetId: person.id,
    metadata: { communityId, byPersonId: actor, via: 'app' },
  });
  res.status(201).json({ ok: true, personId: person.id, name: person.name });
}));

export default router;
