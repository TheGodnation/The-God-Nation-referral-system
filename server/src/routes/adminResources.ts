import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { requireCsrf } from '../lib/csrf';
import { parsePagination, paginatedResult } from '../lib/pagination';
import { recordAudit } from '../lib/audit';
import { leadershipMutationLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';

const router = Router();

// Admin (Central Authority) only — the Resource CATALOG. Granting/revoking
// access for a specific Person lives in adminResourceAccess.ts instead
// (mounted at '/api/admin/people/:personId/resource-access' — same
// per-concern file split as every other admin*/leader* pair in this app).
router.use(requireAuth, requireRole('ADMIN'));

const listQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
});

// GET /api/admin/resources — `search` mode is a flat, bounded name lookup
// (used by the "grant a Resource" picker in PeopleTab), same pattern as the
// Community/Geography/Devotional search endpoints. Otherwise, the full
// catalog, page-based.
router.get('/', asyncHandler(async (req, res) => {
  const { page, pageSize, skip, take } = parsePagination(req);
  const q = listQuerySchema.parse(req.query);

  if (q.search) {
    const matches = await prisma.resource.findMany({
      where: { titleEn: { contains: q.search, mode: 'insensitive' } },
      take: 20,
      orderBy: { titleEn: 'asc' },
    });
    return res.json({ items: matches });
  }

  const [total, items] = await Promise.all([
    prisma.resource.count(),
    prisma.resource.findMany({
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
  ]);

  res.json(paginatedResult(items, total, page, pageSize));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const resource = await prisma.resource.findUnique({ where: { id: req.params.id } });
  if (!resource) return res.status(404).json({ error: 'Resource not found.' });
  res.json(resource);
}));

const urlSchema = z
  .string()
  .trim()
  .url()
  .max(2000)
  .optional()
  .nullable()
  .or(z.literal('').transform(() => null));

const createSchema = z.object({
  titleEn: z.string().trim().min(1).max(300),
  titleFr: z.string().trim().max(300).optional().nullable(),
  descriptionEn: z.string().trim().max(2000).optional().nullable(),
  descriptionFr: z.string().trim().max(2000).optional().nullable(),
  url: urlSchema,
  active: z.boolean().optional(),
});

router.post('/', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid resource.' });
  }
  const d = parsed.data;

  const created = await prisma.resource.create({
    data: {
      titleEn: d.titleEn,
      titleFr: d.titleFr ?? null,
      descriptionEn: d.descriptionEn ?? null,
      descriptionFr: d.descriptionFr ?? null,
      url: d.url ?? null,
      active: d.active ?? true,
    },
  });

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'RESOURCE_CREATED',
    targetType: 'Resource',
    targetId: created.id,
    metadata: { titleEn: created.titleEn },
  });

  res.status(201).json(created);
}));

const patchSchema = createSchema.partial();

router.patch('/:id', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request.' });
  }
  const d = parsed.data;

  const existing = await prisma.resource.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Resource not found.' });

  const updated = await prisma.resource.update({
    where: { id },
    data: {
      ...(d.titleEn !== undefined ? { titleEn: d.titleEn } : {}),
      ...(d.titleFr !== undefined ? { titleFr: d.titleFr } : {}),
      ...(d.descriptionEn !== undefined ? { descriptionEn: d.descriptionEn } : {}),
      ...(d.descriptionFr !== undefined ? { descriptionFr: d.descriptionFr } : {}),
      ...(d.url !== undefined ? { url: d.url } : {}),
      ...(d.active !== undefined ? { active: d.active } : {}),
    },
  });

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'RESOURCE_UPDATED',
    targetType: 'Resource',
    targetId: id,
    metadata: { changedKeys: Object.keys(req.body ?? {}) },
  });

  res.json(updated);
}));

export default router;
