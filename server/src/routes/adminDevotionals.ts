import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { requireCsrf } from '../lib/csrf';
import { parsePagination, paginatedResult } from '../lib/pagination';
import { recordAudit } from '../lib/audit';
import { asyncHandler } from '../lib/asyncHandler';
import { computeDevotionalCompletionForPersons } from '../lib/trainingProgress';

const router = Router();

router.use(requireAuth, requireRole('ADMIN'));

const listQuerySchema = z.object({
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
  communityId: z.string().optional(),
  search: z.string().trim().min(1).max(200).optional(),
});

router.get('/', asyncHandler(async (req, res) => {
  const { page, pageSize, skip, take } = parsePagination(req);
  const q = listQuerySchema.parse(req.query);

  // `search` mode — used by the "select a devotional" picker when creating
  // an Assessment — is a flat, bounded name lookup, same pattern as the
  // Geography/Community search endpoints.
  if (q.search) {
    const matches = await prisma.monthlyDevotional.findMany({
      where: { titleEn: { contains: q.search, mode: 'insensitive' } },
      take: 20,
      orderBy: { startDate: 'desc' },
    });
    return res.json({ items: matches });
  }

  const where = {
    ...(q.status ? { status: q.status } : {}),
    ...(q.communityId ? { communityId: q.communityId } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.monthlyDevotional.count({ where }),
    prisma.monthlyDevotional.findMany({
      where,
      include: {
        community: { select: { id: true, name: true } },
        _count: { select: { assessments: true } },
      },
      orderBy: { startDate: 'desc' },
      skip,
      take,
    }),
  ]);

  res.json(paginatedResult(items, total, page, pageSize));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const devotional = await prisma.monthlyDevotional.findUnique({
    where: { id: req.params.id },
    include: {
      community: { select: { id: true, name: true } },
      assessments: { select: { id: true, titleEn: true, titleFr: true, status: true, passMark: true, maxAttempts: true } },
    },
  });
  if (!devotional) return res.status(404).json({ error: 'Devotional not found.' });
  res.json(devotional);
}));

// GET /api/admin/devotionals/:id/completion-summary — Phase 3E. Population
// semantics are deliberately different depending on whether the devotional
// is Community-scoped or global, matching the existing Member eligibility
// rule exactly:
//  - Community-scoped (communityId set): population is every Person with an
//    ACTIVE CommunityMembership in that EXACT Community — never a parent or
//    child Community, never someone merely Geography-assigned, never a
//    former/inactive member.
//  - Global (communityId null): under the existing Member eligibility rule
//    a global devotional has no Community restriction at all, so the
//    population is every Person — this is not a new "everyone" concept
//    invented for Phase 3E, it is the literal implication of the rule
//    already used by GET /api/member/devotionals for a global devotional.
// Paginated using the same convention as every other list in this file.
router.get('/:id/completion-summary', asyncHandler(async (req, res) => {
  const devotional = await prisma.monthlyDevotional.findUnique({
    where: { id: req.params.id },
    select: { id: true, communityId: true },
  });
  if (!devotional) return res.status(404).json({ error: 'Devotional not found.' });

  const { page, pageSize, skip, take } = parsePagination(req);

  let total: number;
  let personIds: string[];
  if (devotional.communityId) {
    const where = { communityId: devotional.communityId, status: 'ACTIVE' as const };
    total = await prisma.communityMembership.count({ where });
    const memberships = await prisma.communityMembership.findMany({
      where,
      select: { personId: true },
      orderBy: { joinedAt: 'asc' },
      skip,
      take,
    });
    personIds = memberships.map((m) => m.personId);
  } else {
    total = await prisma.person.count();
    const persons = await prisma.person.findMany({
      select: { id: true },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
    personIds = persons.map((p) => p.id);
  }

  const rows = await computeDevotionalCompletionForPersons(devotional.id, personIds);
  res.json(paginatedResult(rows ?? [], total, page, pageSize));
}));

const dateSchema = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'Invalid date.' })
  .transform((v) => new Date(v));

const createSchema = z.object({
  titleEn: z.string().trim().min(1).max(300),
  titleFr: z.string().trim().max(300).optional().nullable(),
  descriptionEn: z.string().trim().max(2000).optional().nullable(),
  descriptionFr: z.string().trim().max(2000).optional().nullable(),
  contentEn: z.string().trim().min(1).max(50000),
  contentFr: z.string().trim().max(50000).optional().nullable(),
  coverImageUrl: z.string().trim().url().max(2000).optional().nullable().or(z.literal('').transform(() => null)),
  communityId: z.string().optional().nullable(),
  startDate: dateSchema,
  endDate: dateSchema,
});

router.post('/', requireCsrf, asyncHandler(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid devotional.' });
  }
  const d = parsed.data;

  if (d.endDate < d.startDate) {
    return res.status(400).json({ error: 'End date must be on or after the start date.' });
  }

  if (d.communityId) {
    const community = await prisma.community.findUnique({ where: { id: d.communityId } });
    if (!community) return res.status(400).json({ error: 'Community not found.' });
  }

  const created = await prisma.monthlyDevotional.create({
    data: {
      titleEn: d.titleEn,
      titleFr: d.titleFr ?? null,
      descriptionEn: d.descriptionEn ?? null,
      descriptionFr: d.descriptionFr ?? null,
      contentEn: d.contentEn,
      contentFr: d.contentFr ?? null,
      coverImageUrl: d.coverImageUrl ?? null,
      communityId: d.communityId ?? null,
      startDate: d.startDate,
      endDate: d.endDate,
    },
  });

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'DEVOTIONAL_CREATED',
    targetType: 'MonthlyDevotional',
    targetId: created.id,
    metadata: { titleEn: created.titleEn, communityId: created.communityId },
  });

  res.status(201).json(created);
}));

const patchSchema = createSchema.partial().extend({
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
});

router.patch('/:id', requireCsrf, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request.' });
  }
  const d = parsed.data;

  const existing = await prisma.monthlyDevotional.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Devotional not found.' });

  const startDate = d.startDate ?? existing.startDate;
  const endDate = d.endDate ?? existing.endDate;
  if (endDate < startDate) {
    return res.status(400).json({ error: 'End date must be on or after the start date.' });
  }

  if (d.communityId) {
    const community = await prisma.community.findUnique({ where: { id: d.communityId } });
    if (!community) return res.status(400).json({ error: 'Community not found.' });
  }

  const updated = await prisma.monthlyDevotional.update({
    where: { id },
    data: {
      ...(d.titleEn !== undefined ? { titleEn: d.titleEn } : {}),
      ...(d.titleFr !== undefined ? { titleFr: d.titleFr } : {}),
      ...(d.descriptionEn !== undefined ? { descriptionEn: d.descriptionEn } : {}),
      ...(d.descriptionFr !== undefined ? { descriptionFr: d.descriptionFr } : {}),
      ...(d.contentEn !== undefined ? { contentEn: d.contentEn } : {}),
      ...(d.contentFr !== undefined ? { contentFr: d.contentFr } : {}),
      ...(d.coverImageUrl !== undefined ? { coverImageUrl: d.coverImageUrl } : {}),
      ...(d.communityId !== undefined ? { communityId: d.communityId } : {}),
      ...(d.startDate !== undefined ? { startDate: d.startDate } : {}),
      ...(d.endDate !== undefined ? { endDate: d.endDate } : {}),
      ...(d.status !== undefined ? { status: d.status } : {}),
    },
  });

  // Distinct audit actions for the two meaningful lifecycle transitions,
  // matching the spec's explicit audit list; anything else is a generic
  // content update.
  let action = 'DEVOTIONAL_UPDATED';
  if (d.status === 'PUBLISHED' && existing.status !== 'PUBLISHED') action = 'DEVOTIONAL_PUBLISHED';
  if (d.status === 'ARCHIVED' && existing.status !== 'ARCHIVED') action = 'DEVOTIONAL_ARCHIVED';

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action,
    targetType: 'MonthlyDevotional',
    targetId: id,
    metadata: { changedKeys: Object.keys(req.body ?? {}) },
  });

  res.json(updated);
}));

export default router;
