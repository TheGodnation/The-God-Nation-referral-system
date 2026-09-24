import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { requireCsrf } from '../lib/csrf';
import { parsePagination, paginatedResult } from '../lib/pagination';
import { recordAudit } from '../lib/audit';
import { announcementMutationLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import { validateTargetReferences } from '../lib/announcements';

const router = Router();

router.use(requireAuth, requireRole('ADMIN'));

const targetSchema = z
  .object({
    communityId: z.string().min(1).optional(),
    geographyId: z.string().min(1).optional(),
  })
  .refine((t) => Boolean(t.communityId) !== Boolean(t.geographyId), {
    message: 'Each target must have exactly one of communityId or geographyId.',
  });

const targetInclude = {
  targets: {
    include: {
      community: { select: { id: true, name: true } },
      geography: { select: { id: true, name: true } },
    },
  },
  createdBy: { select: { id: true, email: true } },
} as const;

function toAdminResponse(a: {
  id: string;
  titleEn: string;
  titleFr: string | null;
  bodyEn: string;
  bodyFr: string | null;
  createdAt: Date;
  publishedAt: Date | null;
  archivedAt: Date | null;
  createdBy: { id: string; email: string };
  targets: {
    id: string;
    communityId: string | null;
    geographyId: string | null;
    community: { id: string; name: string } | null;
    geography: { id: string; name: string } | null;
  }[];
}) {
  return {
    id: a.id,
    titleEn: a.titleEn,
    titleFr: a.titleFr,
    bodyEn: a.bodyEn,
    bodyFr: a.bodyFr,
    createdAt: a.createdAt,
    publishedAt: a.publishedAt,
    archivedAt: a.archivedAt,
    createdBy: a.createdBy,
    targets: a.targets.map((t) => ({
      id: t.id,
      communityId: t.communityId,
      communityName: t.community?.name ?? null,
      geographyId: t.geographyId,
      geographyName: t.geography?.name ?? null,
    })),
  };
}

// GET /api/admin/announcements — page-based, newest-created-first. Never
// exposes a per-Person recipient list or audience count — target
// definitions only (Community/Geography names), matching what an Admin
// configured, not who currently qualifies.
router.get('/', asyncHandler(async (req, res) => {
  const { page, pageSize, skip, take } = parsePagination(req);

  const [total, rows] = await Promise.all([
    prisma.announcement.count(),
    prisma.announcement.findMany({
      include: targetInclude,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
  ]);

  res.json(paginatedResult(rows.map(toAdminResponse), total, page, pageSize));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const announcement = await prisma.announcement.findUnique({
    where: { id: req.params.id },
    include: targetInclude,
  });
  if (!announcement) return res.status(404).json({ error: 'Announcement not found.' });
  res.json(toAdminResponse(announcement));
}));

const createSchema = z.object({
  titleEn: z.string().trim().min(1).max(300),
  titleFr: z.string().trim().min(1).max(300).optional().nullable(),
  bodyEn: z.string().trim().min(1).max(10000),
  bodyFr: z.string().trim().min(1).max(10000).optional().nullable(),
  targets: z.array(targetSchema).max(50).optional(),
});

// POST /api/admin/announcements — always created as a draft (publishedAt
// and archivedAt both null); createdByUserId is always req.user!.id, never
// accepted from the body. Targets are optional at creation time — a draft
// may exist with no targets yet and gain them via PATCH before publish.
router.post('/', announcementMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid announcement.' });
  }
  const d = parsed.data;

  if (d.targets && d.targets.length > 0) {
    const valid = await validateTargetReferences(d.targets);
    if (!valid) return res.status(400).json({ error: 'One or more targets reference an unknown Community or Geography.' });
  }

  const created = await prisma.announcement.create({
    data: {
      titleEn: d.titleEn,
      titleFr: d.titleFr ?? null,
      bodyEn: d.bodyEn,
      bodyFr: d.bodyFr ?? null,
      createdByUserId: req.user!.id,
      targets: d.targets && d.targets.length > 0
        ? { create: d.targets.map((t) => ({ communityId: t.communityId ?? null, geographyId: t.geographyId ?? null })) }
        : undefined,
    },
    include: targetInclude,
  });

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'ANNOUNCEMENT_CREATED',
    targetType: 'Announcement',
    targetId: created.id,
    metadata: { titleEn: created.titleEn, targetCount: created.targets.length },
  });

  res.status(201).json(toAdminResponse(created));
}));

const patchSchema = z.object({
  titleEn: z.string().trim().min(1).max(300).optional(),
  titleFr: z.string().trim().min(1).max(300).optional().nullable(),
  bodyEn: z.string().trim().min(1).max(10000).optional(),
  bodyFr: z.string().trim().min(1).max(10000).optional().nullable(),
  targets: z.array(targetSchema).max(50).optional(),
});

// PATCH /api/admin/announcements/:id — draft only. Once published or
// archived, content and targets are immutable — no normal editing path
// exists past that point (archiving is the only further transition).
router.patch('/:id', announcementMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request.' });
  }
  const d = parsed.data;

  const existing = await prisma.announcement.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Announcement not found.' });
  if (existing.publishedAt || existing.archivedAt) {
    return res.status(409).json({ error: 'Only a draft announcement can be edited.' });
  }

  if (d.targets && d.targets.length > 0) {
    const valid = await validateTargetReferences(d.targets);
    if (!valid) return res.status(400).json({ error: 'One or more targets reference an unknown Community or Geography.' });
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (d.targets !== undefined) {
      await tx.announcementTarget.deleteMany({ where: { announcementId: id } });
      if (d.targets.length > 0) {
        await tx.announcementTarget.createMany({
          data: d.targets.map((t) => ({ announcementId: id, communityId: t.communityId ?? null, geographyId: t.geographyId ?? null })),
        });
      }
    }
    return tx.announcement.update({
      where: { id },
      data: {
        ...(d.titleEn !== undefined ? { titleEn: d.titleEn } : {}),
        ...(d.titleFr !== undefined ? { titleFr: d.titleFr } : {}),
        ...(d.bodyEn !== undefined ? { bodyEn: d.bodyEn } : {}),
        ...(d.bodyFr !== undefined ? { bodyFr: d.bodyFr } : {}),
      },
      include: targetInclude,
    });
  });

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'ANNOUNCEMENT_UPDATED',
    targetType: 'Announcement',
    targetId: id,
    metadata: { changedKeys: Object.keys(req.body ?? {}) },
  });

  res.json(toAdminResponse(updated));
}));

// POST /api/admin/announcements/:id/publish — immediate, atomic
// (compare-and-swap on publishedAt IS NULL / archivedAt IS NULL), requires
// at least one target. No scheduling, no delay, no background job.
router.post('/:id/publish', announcementMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const existing = await prisma.announcement.findUnique({
    where: { id },
    include: { targets: { select: { communityId: true, geographyId: true } } },
  });
  if (!existing) return res.status(404).json({ error: 'Announcement not found.' });
  if (existing.archivedAt) return res.status(409).json({ error: 'An archived announcement cannot be published.' });
  if (existing.publishedAt) return res.status(409).json({ error: 'This announcement is already published.' });
  if (existing.targets.length === 0) {
    return res.status(400).json({ error: 'At least one target is required before publishing.' });
  }
  const valid = await validateTargetReferences(existing.targets);
  if (!valid) return res.status(400).json({ error: 'One or more targets reference an unknown Community or Geography.' });

  const result = await prisma.announcement.updateMany({
    where: { id, publishedAt: null, archivedAt: null },
    data: { publishedAt: new Date() },
  });
  if (result.count !== 1) {
    return res.status(409).json({ error: 'This announcement was already published or archived.' });
  }

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'ANNOUNCEMENT_PUBLISHED',
    targetType: 'Announcement',
    targetId: id,
  });

  const updated = await prisma.announcement.findUnique({ where: { id }, include: targetInclude });
  res.json(toAdminResponse(updated!));
}));

// POST /api/admin/announcements/:id/archive — works from either draft or
// published state (this is also how an unpublished draft is discarded —
// there is no separate hard-delete path, matching the codebase's universal
// status/timestamp lifecycle convention). Atomic compare-and-swap on
// archivedAt IS NULL.
router.post('/:id/archive', announcementMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const existing = await prisma.announcement.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Announcement not found.' });
  if (existing.archivedAt) return res.status(409).json({ error: 'This announcement is already archived.' });

  const result = await prisma.announcement.updateMany({
    where: { id, archivedAt: null },
    data: { archivedAt: new Date() },
  });
  if (result.count !== 1) {
    return res.status(409).json({ error: 'This announcement is already archived.' });
  }

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'ANNOUNCEMENT_ARCHIVED',
    targetType: 'Announcement',
    targetId: id,
  });

  const updated = await prisma.announcement.findUnique({ where: { id }, include: targetInclude });
  res.json(toAdminResponse(updated!));
}));

export default router;
