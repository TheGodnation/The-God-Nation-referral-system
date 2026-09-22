import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { requireCsrf } from '../lib/csrf';
import { parsePagination, paginatedResult } from '../lib/pagination';
import { recordAudit } from '../lib/audit';
import { wouldCreateCycle } from '../lib/tree';
import { communityGeographyMutationLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';

const router = Router();

router.use(requireAuth, requireRole('ADMIN'));

const listQuerySchema = z.object({
  parentId: z.string().optional(),
  search: z.string().trim().min(1).max(200).optional(),
});

// GET /api/admin/communities — same two-mode shape as Geography: `search`
// for a flat name lookup (used by the "add Person to Community" picker),
// otherwise browse mode (children of `parentId`, or root communities when
// omitted). Never loads the whole hierarchy at once.
router.get('/', asyncHandler(async (req, res) => {
  const { page, pageSize, skip, take } = parsePagination(req);
  const q = listQuerySchema.parse(req.query);

  if (q.search) {
    const matches = await prisma.community.findMany({
      where: { name: { contains: q.search, mode: 'insensitive' } },
      include: { parent: { select: { id: true, name: true } } },
      take: 20,
      orderBy: { name: 'asc' },
    });
    return res.json({ items: matches });
  }

  const where = { parentId: q.parentId ? q.parentId : null };

  const [total, nodes] = await Promise.all([
    prisma.community.count({ where }),
    prisma.community.findMany({
      where,
      include: {
        parent: { select: { id: true, name: true } },
        _count: { select: { children: true, memberships: true } },
      },
      orderBy: { name: 'asc' },
      skip,
      take,
    }),
  ]);

  res.json(paginatedResult(nodes, total, page, pageSize));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const node = await prisma.community.findUnique({
    where: { id: req.params.id },
    include: {
      parent: { select: { id: true, name: true } },
      _count: { select: { children: true, memberships: true } },
    },
  });
  if (!node) return res.status(404).json({ error: 'Community not found.' });
  res.json(node);
}));

// GET /api/admin/communities/:id/members — paginated CommunityMembership
// rows for this community, with a light Person summary per row.
router.get('/:id/members', asyncHandler(async (req, res) => {
  const community = await prisma.community.findUnique({ where: { id: req.params.id } });
  if (!community) return res.status(404).json({ error: 'Community not found.' });

  const { page, pageSize, skip, take } = parsePagination(req);
  const [total, memberships] = await Promise.all([
    prisma.communityMembership.count({ where: { communityId: req.params.id } }),
    prisma.communityMembership.findMany({
      where: { communityId: req.params.id },
      include: { person: { select: { id: true, name: true, whatsappNumber: true } } },
      orderBy: { joinedAt: 'desc' },
      skip,
      take,
    }),
  ]);

  res.json(paginatedResult(memberships, total, page, pageSize));
}));

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  parentId: z.string().optional().nullable(),
  active: z.boolean().optional(),
});

router.post('/', communityGeographyMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid community.' });
  }
  const d = parsed.data;

  if (d.parentId) {
    const parent = await prisma.community.findUnique({ where: { id: d.parentId } });
    if (!parent) return res.status(400).json({ error: 'Parent community not found.' });
  }

  const created = await prisma.community.create({
    data: { name: d.name, parentId: d.parentId ?? null, active: d.active ?? true },
  });

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'COMMUNITY_CREATED',
    targetType: 'Community',
    targetId: created.id,
    metadata: { name: created.name, parentId: created.parentId },
  });

  res.status(201).json(created);
}));

const patchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  parentId: z.string().optional().nullable(),
  active: z.boolean().optional(),
});

router.patch('/:id', communityGeographyMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request.' });
  }
  const d = parsed.data;

  const existing = await prisma.community.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Community not found.' });

  if (d.parentId !== undefined && d.parentId !== null) {
    if (d.parentId === id) {
      return res.status(400).json({ error: 'A community cannot be its own parent.' });
    }
    const newParent = await prisma.community.findUnique({ where: { id: d.parentId } });
    if (!newParent) return res.status(400).json({ error: 'Parent community not found.' });
    const cycle = await wouldCreateCycle(
      (nid) => prisma.community.findUnique({ where: { id: nid }, select: { id: true, parentId: true } }),
      id,
      d.parentId,
    );
    if (cycle) {
      return res.status(400).json({ error: 'This would make the community a descendant of itself.' });
    }
  }

  const updated = await prisma.community.update({
    where: { id },
    data: {
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.parentId !== undefined ? { parentId: d.parentId } : {}),
      ...(d.active !== undefined ? { active: d.active } : {}),
    },
  });

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'COMMUNITY_UPDATED',
    targetType: 'Community',
    targetId: id,
    metadata: { changedKeys: Object.keys(req.body ?? {}) },
  });

  res.json(updated);
}));

export default router;
