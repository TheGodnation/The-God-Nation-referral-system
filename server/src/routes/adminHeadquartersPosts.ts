import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { requireCsrf } from '../lib/csrf';
import { parsePagination, paginatedResult } from '../lib/pagination';
import { recordAudit } from '../lib/audit';
import { headquartersPostMutationLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import { validateCommunityTargetReferences } from '../lib/headquartersPosts';

const router = Router();

// Admin (Central Authority) only — Headquarters Posts are not Leader- or
// Community-Administrator-authorable in this phase, and there is no
// configurable permission system introduced to change that.
router.use(requireAuth, requireRole('ADMIN'));

const targetInclude = {
  targets: {
    include: {
      community: { select: { id: true, name: true } },
    },
  },
  createdBy: { select: { id: true, email: true } },
  _count: { select: { comments: true, reactions: true } },
} as const;

function toAdminResponse(p: {
  id: string;
  titleEn: string;
  titleFr: string | null;
  bodyEn: string;
  bodyFr: string | null;
  networkWide: boolean;
  createdAt: Date;
  publishedAt: Date | null;
  archivedAt: Date | null;
  createdBy: { id: string; email: string };
  targets: { id: string; communityId: string; community: { id: string; name: string } }[];
  _count: { comments: number; reactions: number };
}) {
  return {
    id: p.id,
    titleEn: p.titleEn,
    titleFr: p.titleFr,
    bodyEn: p.bodyEn,
    bodyFr: p.bodyFr,
    networkWide: p.networkWide,
    createdAt: p.createdAt,
    publishedAt: p.publishedAt,
    archivedAt: p.archivedAt,
    createdBy: p.createdBy,
    targets: p.targets.map((t) => ({ id: t.id, communityId: t.communityId, communityName: t.community.name })),
    commentCount: p._count.comments,
    reactionCount: p._count.reactions,
  };
}

// GET /api/admin/headquarters-posts — page-based, newest-created-first.
router.get('/', asyncHandler(async (req, res) => {
  const { page, pageSize, skip, take } = parsePagination(req);

  const [total, rows] = await Promise.all([
    prisma.headquartersPost.count(),
    prisma.headquartersPost.findMany({
      include: targetInclude,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
  ]);

  res.json(paginatedResult(rows.map(toAdminResponse), total, page, pageSize));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const post = await prisma.headquartersPost.findUnique({
    where: { id: req.params.id },
    include: targetInclude,
  });
  if (!post) return res.status(404).json({ error: 'Headquarters post not found.' });
  res.json(toAdminResponse(post));
}));

const createSchema = z.object({
  titleEn: z.string().trim().min(1).max(300),
  titleFr: z.string().trim().min(1).max(300).optional().nullable(),
  bodyEn: z.string().trim().min(1).max(10000),
  bodyFr: z.string().trim().min(1).max(10000).optional().nullable(),
});

// POST /api/admin/headquarters-posts — always created as a draft
// (publishedAt/archivedAt both null, networkWide false, no targets).
// createdByUserId is always req.user!.id, never accepted from the body.
router.post('/', headquartersPostMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid headquarters post.' });
  }
  const d = parsed.data;

  const created = await prisma.headquartersPost.create({
    data: {
      titleEn: d.titleEn,
      titleFr: d.titleFr ?? null,
      bodyEn: d.bodyEn,
      bodyFr: d.bodyFr ?? null,
      createdByUserId: req.user!.id,
    },
    include: targetInclude,
  });

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'HEADQUARTERS_POST_CREATED',
    targetType: 'HeadquartersPost',
    targetId: created.id,
    metadata: { titleEn: created.titleEn },
  });

  res.status(201).json(toAdminResponse(created));
}));

const patchSchema = z.object({
  titleEn: z.string().trim().min(1).max(300).optional(),
  titleFr: z.string().trim().min(1).max(300).optional().nullable(),
  bodyEn: z.string().trim().min(1).max(10000).optional(),
  bodyFr: z.string().trim().min(1).max(10000).optional().nullable(),
  networkWide: z.boolean().optional(),
  targetCommunityIds: z.array(z.string().min(1)).max(50).optional(),
});

// PATCH /api/admin/headquarters-posts/:id — draft only. Once published or
// archived, content and audience are immutable — no normal editing path
// exists past that point (archiving is the only further transition).
// networkWide and targetCommunityIds are mutually exclusive: setting
// networkWide true clears any existing targets, and setting
// targetCommunityIds (non-empty) clears networkWide back to false — the two
// audience modes can never both be active at once.
router.patch('/:id', headquartersPostMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request.' });
  }
  const d = parsed.data;

  const existing = await prisma.headquartersPost.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Headquarters post not found.' });
  if (existing.publishedAt || existing.archivedAt) {
    return res.status(409).json({ error: 'Only a draft headquarters post can be edited.' });
  }

  if (d.targetCommunityIds && d.targetCommunityIds.length > 0) {
    const valid = await validateCommunityTargetReferences(d.targetCommunityIds);
    if (!valid) return res.status(400).json({ error: 'One or more targets reference an unknown Community.' });
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (d.networkWide === true) {
      await tx.headquartersPostTarget.deleteMany({ where: { headquartersPostId: id } });
    } else if (d.targetCommunityIds !== undefined) {
      await tx.headquartersPostTarget.deleteMany({ where: { headquartersPostId: id } });
      if (d.targetCommunityIds.length > 0) {
        await tx.headquartersPostTarget.createMany({
          data: d.targetCommunityIds.map((communityId) => ({ headquartersPostId: id, communityId })),
        });
      }
    }
    return tx.headquartersPost.update({
      where: { id },
      data: {
        ...(d.titleEn !== undefined ? { titleEn: d.titleEn } : {}),
        ...(d.titleFr !== undefined ? { titleFr: d.titleFr } : {}),
        ...(d.bodyEn !== undefined ? { bodyEn: d.bodyEn } : {}),
        ...(d.bodyFr !== undefined ? { bodyFr: d.bodyFr } : {}),
        ...(d.networkWide === true
          ? { networkWide: true }
          : d.targetCommunityIds !== undefined
            ? { networkWide: false }
            : {}),
      },
      include: targetInclude,
    });
  });

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'HEADQUARTERS_POST_UPDATED',
    targetType: 'HeadquartersPost',
    targetId: id,
    metadata: { changedKeys: Object.keys(req.body ?? {}) },
  });

  res.json(toAdminResponse(updated));
}));

// POST /api/admin/headquarters-posts/:id/publish — immediate, atomic
// (compare-and-swap on publishedAt IS NULL / archivedAt IS NULL), requires
// an audience: either networkWide, or at least one target Community.
router.post('/:id/publish', headquartersPostMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const existing = await prisma.headquartersPost.findUnique({
    where: { id },
    include: { targets: { select: { communityId: true } } },
  });
  if (!existing) return res.status(404).json({ error: 'Headquarters post not found.' });
  if (existing.archivedAt) return res.status(409).json({ error: 'An archived headquarters post cannot be published.' });
  if (existing.publishedAt) return res.status(409).json({ error: 'This headquarters post is already published.' });
  if (!existing.networkWide && existing.targets.length === 0) {
    return res.status(400).json({ error: 'An audience is required before publishing: choose network-wide or at least one Community.' });
  }
  if (existing.targets.length > 0) {
    const valid = await validateCommunityTargetReferences(existing.targets.map((t) => t.communityId));
    if (!valid) return res.status(400).json({ error: 'One or more targets reference an unknown Community.' });
  }

  const result = await prisma.headquartersPost.updateMany({
    where: { id, publishedAt: null, archivedAt: null },
    data: { publishedAt: new Date() },
  });
  if (result.count !== 1) {
    return res.status(409).json({ error: 'This headquarters post was already published or archived.' });
  }

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'HEADQUARTERS_POST_PUBLISHED',
    targetType: 'HeadquartersPost',
    targetId: id,
  });

  const updated = await prisma.headquartersPost.findUnique({ where: { id }, include: targetInclude });
  res.json(toAdminResponse(updated!));
}));

// POST /api/admin/headquarters-posts/:id/archive — works from either draft
// or published state (also how an unpublished draft is discarded — there is
// no separate hard-delete path). Atomic compare-and-swap on archivedAt IS
// NULL.
router.post('/:id/archive', headquartersPostMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const existing = await prisma.headquartersPost.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Headquarters post not found.' });
  if (existing.archivedAt) return res.status(409).json({ error: 'This headquarters post is already archived.' });

  const result = await prisma.headquartersPost.updateMany({
    where: { id, archivedAt: null },
    data: { archivedAt: new Date() },
  });
  if (result.count !== 1) {
    return res.status(409).json({ error: 'This headquarters post is already archived.' });
  }

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'HEADQUARTERS_POST_ARCHIVED',
    targetType: 'HeadquartersPost',
    targetId: id,
  });

  const updated = await prisma.headquartersPost.findUnique({ where: { id }, include: targetInclude });
  res.json(toAdminResponse(updated!));
}));

export default router;
