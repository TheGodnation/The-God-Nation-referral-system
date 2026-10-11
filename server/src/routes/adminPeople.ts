import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { requireCsrf } from '../lib/csrf';
import { normalizeToE164 } from '../lib/phone';
import { parsePagination, paginatedResult } from '../lib/pagination';
import { recordAudit } from '../lib/audit';
import { asyncHandler } from '../lib/asyncHandler';
import { computeTrainingProgressForPerson } from '../lib/trainingProgress';

const router = Router();

router.use(requireAuth, requireRole('ADMIN'));

function includeTestData(req: any): boolean {
  return req.query.includeTestData === 'true';
}

const listQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
});

// GET /api/admin/people — search/filter, paginated. Each row includes only
// what the People list UI needs: a membership count — not the full
// membership list, which is fetched only when an Admin opens a specific
// person's detail.
router.get('/people', asyncHandler(async (req, res) => {
  const { page, pageSize, skip, take } = parsePagination(req);
  const q = listQuerySchema.parse(req.query);
  const testFilter = includeTestData(req) ? {} : { isTestData: false };

  const where: Prisma.PersonWhereInput = {
    ...testFilter,
    ...(q.search
      ? {
          OR: [
            { name: { contains: q.search, mode: 'insensitive' } },
            { whatsappNumber: { contains: q.search } },
            { email: { contains: q.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [total, people] = await Promise.all([
    prisma.person.count({ where }),
    prisma.person.findMany({
      where,
      include: {
        _count: { select: { communityMemberships: true, registrations: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
  ]);

  res.json(paginatedResult(people, total, page, pageSize));
}));

// GET /api/admin/people/:id — full detail for one Person.
router.get('/people/:id', asyncHandler(async (req, res) => {
  const person = await prisma.person.findUnique({
    where: { id: req.params.id },
    include: {
      communityMemberships: {
        include: { community: { select: { id: true, name: true } } },
        orderBy: { joinedAt: 'desc' },
      },
      registrations: {
        select: { id: true, language: true, pathway: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
      users: { select: { id: true, name: true, email: true, role: true } },
    },
  });
  if (!person) return res.status(404).json({ error: 'Person not found.' });
  res.json(person);
}));

// GET /api/admin/people/:id/training-progress — Phase 3E. Admin may inspect
// any Person's derived progress, regardless of Community/Geography scope. A
// Person with no eligible devotional returns a clean zero-value result
// (totalEligible: 0), never an error — only a genuinely nonexistent Person
// is a 404.
router.get('/people/:id/training-progress', asyncHandler(async (req, res) => {
  const person = await prisma.person.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!person) return res.status(404).json({ error: 'Person not found.' });

  const progress = await computeTrainingProgressForPerson(person.id);
  res.json(progress);
}));

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  whatsappNumber: z.string().trim().min(1).max(32),
  email: z
    .string()
    .trim()
    .email()
    .max(320)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  preferredLanguage: z.enum(['en', 'fr']).optional(),
});

router.post('/people', requireCsrf, asyncHandler(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid person.' });
  }
  const { name, whatsappNumber, email, preferredLanguage } = parsed.data;

  const normalized = normalizeToE164(whatsappNumber);
  if (!normalized) {
    return res.status(400).json({ error: 'Please enter a valid WhatsApp number, including country code.' });
  }

  const existing = await prisma.person.findUnique({ where: { whatsappNumber: normalized } });
  if (existing) {
    return res.status(409).json({ error: 'A person with this WhatsApp number already exists.' });
  }

  const created = await prisma.person.create({
    data: {
      name,
      whatsappNumber: normalized,
      email: email ?? null,
      preferredLanguage: preferredLanguage ?? 'en',
    },
  });

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'PERSON_CREATED',
    targetType: 'Person',
    targetId: created.id,
    metadata: { whatsappNumber: created.whatsappNumber },
  });

  res.status(201).json(created);
}));

const patchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  whatsappNumber: z.string().trim().min(1).max(32).optional(),
  email: z
    .string()
    .trim()
    .email()
    .max(320)
    .optional()
    .nullable()
    .transform((v) => (v === undefined ? undefined : v ? v : null)),
  preferredLanguage: z.enum(['en', 'fr']).optional(),
});

router.patch('/people/:id', requireCsrf, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request.' });
  }
  const d = parsed.data;

  const person = await prisma.person.findUnique({ where: { id } });
  if (!person) return res.status(404).json({ error: 'Person not found.' });

  let normalizedWhatsApp: string | undefined;
  if (d.whatsappNumber !== undefined) {
    const normalized = normalizeToE164(d.whatsappNumber);
    if (!normalized) {
      return res.status(400).json({ error: 'Please enter a valid WhatsApp number, including country code.' });
    }
    if (normalized !== person.whatsappNumber) {
      const existing = await prisma.person.findUnique({ where: { whatsappNumber: normalized } });
      if (existing) return res.status(409).json({ error: 'A person with this WhatsApp number already exists.' });
    }
    normalizedWhatsApp = normalized;
  }

  const updated = await prisma.person.update({
    where: { id },
    data: {
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(normalizedWhatsApp !== undefined ? { whatsappNumber: normalizedWhatsApp } : {}),
      ...(d.email !== undefined ? { email: d.email } : {}),
      ...(d.preferredLanguage !== undefined ? { preferredLanguage: d.preferredLanguage } : {}),
    },
  });

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'PERSON_UPDATED',
    targetType: 'Person',
    targetId: id,
    metadata: { changedKeys: Object.keys(req.body ?? {}) },
  });

  res.json(updated);
}));

// ---------------------------------------------------------------------------
// Community membership (Phase 3A)
// ---------------------------------------------------------------------------

const addMembershipSchema = z.object({ communityId: z.string().min(1) });

router.post('/people/:id/community-memberships', requireCsrf, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const parsed = addMembershipSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'communityId is required.' });
  }

  const person = await prisma.person.findUnique({ where: { id } });
  if (!person) return res.status(404).json({ error: 'Person not found.' });

  const community = await prisma.community.findUnique({ where: { id: parsed.data.communityId } });
  if (!community) return res.status(400).json({ error: 'Community not found.' });

  const existing = await prisma.communityMembership.findUnique({
    where: { personId_communityId: { personId: id, communityId: community.id } },
  });
  if (existing?.status === 'ACTIVE') {
    return res.status(409).json({ error: 'This person is already an active member of this community.' });
  }

  // Reactivating an existing (inactive) row rather than creating a
  // duplicate — the unique (personId, communityId) constraint is what
  // prevents duplicate active memberships in the same community.
  const membership = existing
    ? await prisma.communityMembership.update({
        where: { id: existing.id },
        data: { status: 'ACTIVE', joinedAt: new Date() },
        include: { community: { select: { id: true, name: true } } },
      })
    : await prisma.communityMembership.create({
        data: { personId: id, communityId: community.id },
        include: { community: { select: { id: true, name: true } } },
      });

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'COMMUNITY_MEMBERSHIP_ADDED',
    targetType: 'Person',
    targetId: id,
    metadata: { communityId: community.id },
  });

  res.status(201).json(membership);
}));

const membershipStatusSchema = z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) });

// PATCH /api/admin/community-memberships/:membershipId — addressed by its
// own id since a membership uniquely identifies its (person, community)
// pair; kept in this file since it's the other half of the Person <->
// Community relationship managed above.
router.patch('/community-memberships/:membershipId', requireCsrf, asyncHandler(async (req, res) => {
  const parsed = membershipStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'A valid status is required.' });
  }

  const membership = await prisma.communityMembership.findUnique({ where: { id: req.params.membershipId } });
  if (!membership) return res.status(404).json({ error: 'Membership not found.' });

  const updated = await prisma.communityMembership.update({
    where: { id: membership.id },
    data: { status: parsed.data.status },
    include: { community: { select: { id: true, name: true } } },
  });

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'COMMUNITY_MEMBERSHIP_STATUS_CHANGED',
    targetType: 'CommunityMembership',
    targetId: membership.id,
    metadata: { status: parsed.data.status },
  });

  res.json(updated);
}));

// ---------------------------------------------------------------------------
// Member Reassignment — atomic Community membership move.
//
// Moves one Person's ACTIVE membership from one Community directly to
// another, as a single transaction: never a state where the source
// membership was removed but the target was not created (or vice versa).
// Reuses the exact same "reactivate an existing row, hard unique constraint
// on (personId, communityId)" mechanism as POST .../community-memberships
// above — no new membership lifecycle. Deliberately touches ONLY
// CommunityMembership: RoleAssignment (leadership), GeographicAssignment,
// ResourceAccessGrant, PrivateConversation/Message, FollowUpAssignment, and
// every other domain are untouched by design — membership and leadership
// are separate systems in this codebase, and this endpoint must not
// silently move or alter leadership data.
// ---------------------------------------------------------------------------

class MembershipMoveConflictError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

const moveMembershipSchema = z.object({
  fromCommunityId: z.string().min(1),
  toCommunityId: z.string().min(1),
});

router.post('/people/:id/community-memberships/move', requireCsrf, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const parsed = moveMembershipSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'fromCommunityId and toCommunityId are required.' });
  }
  const { fromCommunityId, toCommunityId } = parsed.data;

  const person = await prisma.person.findUnique({ where: { id } });
  if (!person) return res.status(404).json({ error: 'Person not found.' });

  if (fromCommunityId === toCommunityId) {
    return res.status(400).json({ error: 'The source and destination Community cannot be the same.', code: 'SAME_COMMUNITY' });
  }

  // Community.active is a display-only toggle everywhere else in this
  // codebase (see adminCommunities.ts's own comment on the Headquarters
  // designation route) — this move deliberately imposes no active-status
  // gate either, matching that established rule rather than inventing one.
  const [fromCommunity, toCommunity] = await Promise.all([
    prisma.community.findUnique({ where: { id: fromCommunityId } }),
    prisma.community.findUnique({ where: { id: toCommunityId } }),
  ]);
  if (!fromCommunity) return res.status(400).json({ error: 'Source Community not found.', code: 'COMMUNITY_UNAVAILABLE' });
  if (!toCommunity) return res.status(400).json({ error: 'Target Community not found.', code: 'COMMUNITY_UNAVAILABLE' });

  const sourceMembership = await prisma.communityMembership.findUnique({
    where: { personId_communityId: { personId: id, communityId: fromCommunityId } },
  });
  if (!sourceMembership || sourceMembership.status !== 'ACTIVE') {
    return res
      .status(404)
      .json({ error: 'This person does not have an active membership in the source Community.', code: 'NOT_IN_SOURCE' });
  }

  const targetMembership = await prisma.communityMembership.findUnique({
    where: { personId_communityId: { personId: id, communityId: toCommunityId } },
  });
  if (targetMembership?.status === 'ACTIVE') {
    return res
      .status(409)
      .json({ error: 'This person already has an active membership in the destination Community.', code: 'ALREADY_IN_TARGET' });
  }

  let moved;
  try {
    moved = await prisma.$transaction(async (tx) => {
      // Atomic compare-and-swap, mirroring the resourceAccessGrant revoke
      // pattern: guards against a concurrent request having already moved
      // this exact membership out from under us between the read above and
      // this write.
      const deactivated = await tx.communityMembership.updateMany({
        where: { id: sourceMembership.id, status: 'ACTIVE' },
        data: { status: 'INACTIVE' },
      });
      if (deactivated.count !== 1) {
        throw new MembershipMoveConflictError(
          'This person does not have an active membership in the source Community.',
          'NOT_IN_SOURCE',
        );
      }

      // Reactivate an existing (inactive) target row rather than creating a
      // duplicate — identical to POST .../community-memberships above. A
      // concurrent request racing to create the same brand-new row instead
      // hits the (personId, communityId) unique constraint (P2002, caught
      // below), never a duplicate ACTIVE row.
      const target = targetMembership
        ? await tx.communityMembership.update({
            where: { id: targetMembership.id },
            data: { status: 'ACTIVE', joinedAt: new Date() },
            select: { id: true, status: true, joinedAt: true, community: { select: { id: true, name: true } } },
          })
        : await tx.communityMembership.create({
            data: { personId: id, communityId: toCommunityId },
            select: { id: true, status: true, joinedAt: true, community: { select: { id: true, name: true } } },
          });

      return target;
    });
  } catch (err) {
    if (err instanceof MembershipMoveConflictError) {
      return res.status(409).json({ error: err.message, code: err.code });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // Transaction rolled back automatically — the source membership is
      // still ACTIVE, exactly as if the move had never been attempted.
      return res
        .status(409)
        .json({ error: 'This person already has an active membership in the destination Community.', code: 'ALREADY_IN_TARGET' });
    }
    throw err;
  }

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'COMMUNITY_MEMBERSHIP_MOVED',
    targetType: 'Person',
    targetId: id,
    metadata: { fromCommunityId, toCommunityId },
  });

  res.json(moved);
}));

export default router;
