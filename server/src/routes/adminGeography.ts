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
  countryCode: z.string().optional(),
  search: z.string().trim().min(1).max(200).optional(),
});

// GET /api/admin/geography — two modes:
//  - `search` given: name search across every level (used by the "assign
//    geography to a Person" picker), each result annotated with its full
//    ancestor path so two same-named nodes in different countries can be
//    told apart.
//  - otherwise: browse mode — children of `parentId`, or root nodes
//    (parentId IS NULL) when omitted. Never loads the whole tree at once.
router.get('/', asyncHandler(async (req, res) => {
  const { page, pageSize, skip, take } = parsePagination(req);
  const q = listQuerySchema.parse(req.query);

  if (q.search) {
    const matches = await prisma.geography.findMany({
      where: {
        name: { contains: q.search, mode: 'insensitive' },
        ...(q.countryCode ? { countryCode: q.countryCode } : {}),
      },
      take: 20,
      orderBy: { name: 'asc' },
    });
    const items = await Promise.all(
      matches.map(async (node) => ({ ...node, path: await buildPath(node.id) })),
    );
    return res.json({ items });
  }

  const where = {
    parentId: q.parentId ? q.parentId : null,
    ...(q.countryCode ? { countryCode: q.countryCode } : {}),
  };

  const [total, nodes] = await Promise.all([
    prisma.geography.count({ where }),
    prisma.geography.findMany({
      where,
      include: { parent: { select: { id: true, name: true } }, _count: { select: { children: true } } },
      orderBy: { name: 'asc' },
      skip,
      take,
    }),
  ]);

  res.json(paginatedResult(nodes, total, page, pageSize));
}));

async function buildPath(id: string): Promise<{ id: string; name: string }[]> {
  const path: { id: string; name: string }[] = [];
  let currentId: string | null = id;
  // Bounded by the tree's actual depth — geographic hierarchies are shallow
  // (a handful of levels), never a risk of an unbounded loop in practice,
  // and the defensive `seen` guard prevents one even if data is malformed.
  const seen = new Set<string>();
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const node: { id: string; name: string; parentId: string | null } | null = await prisma.geography.findUnique({
      where: { id: currentId },
      select: { id: true, name: true, parentId: true },
    });
    if (!node) break;
    path.unshift({ id: node.id, name: node.name });
    currentId = node.parentId;
  }
  return path;
}

router.get('/:id', asyncHandler(async (req, res) => {
  const node = await prisma.geography.findUnique({
    where: { id: req.params.id },
    include: { parent: { select: { id: true, name: true } }, _count: { select: { children: true, assignments: true } } },
  });
  if (!node) return res.status(404).json({ error: 'Geography node not found.' });
  res.json({ ...node, path: await buildPath(node.id) });
}));

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.string().trim().min(1).max(50),
  countryCode: z.string().trim().min(2).max(2).toUpperCase().optional(),
  parentId: z.string().optional().nullable(),
  active: z.boolean().optional(),
});

router.post('/', communityGeographyMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid geography node.' });
  }
  const d = parsed.data;

  let countryCode = d.countryCode;
  if (d.parentId) {
    const parent = await prisma.geography.findUnique({ where: { id: d.parentId } });
    if (!parent) return res.status(400).json({ error: 'Parent geography node not found.' });
    // Denormalized countryCode defaults from the parent when not given —
    // a child almost always shares its ancestor's country.
    countryCode = countryCode ?? parent.countryCode;
  }
  if (!countryCode) {
    return res.status(400).json({ error: 'countryCode is required for a root (no-parent) geography node.' });
  }

  const created = await prisma.geography.create({
    data: {
      name: d.name,
      type: d.type,
      countryCode,
      parentId: d.parentId ?? null,
      active: d.active ?? true,
    },
  });

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'GEOGRAPHY_CREATED',
    targetType: 'Geography',
    targetId: created.id,
    metadata: { name: created.name, type: created.type, countryCode: created.countryCode, parentId: created.parentId },
  });

  res.status(201).json(created);
}));

const patchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  type: z.string().trim().min(1).max(50).optional(),
  countryCode: z.string().trim().min(2).max(2).toUpperCase().optional(),
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

  const existing = await prisma.geography.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Geography node not found.' });

  if (d.parentId !== undefined && d.parentId !== null) {
    if (d.parentId === id) {
      return res.status(400).json({ error: 'A geography node cannot be its own parent.' });
    }
    const newParent = await prisma.geography.findUnique({ where: { id: d.parentId } });
    if (!newParent) return res.status(400).json({ error: 'Parent geography node not found.' });
    const cycle = await wouldCreateCycle(
      (nid) => prisma.geography.findUnique({ where: { id: nid }, select: { id: true, parentId: true } }),
      id,
      d.parentId,
    );
    if (cycle) {
      return res.status(400).json({ error: 'This would make the node a descendant of itself.' });
    }
  }

  const updated = await prisma.geography.update({
    where: { id },
    data: {
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.type !== undefined ? { type: d.type } : {}),
      ...(d.countryCode !== undefined ? { countryCode: d.countryCode } : {}),
      ...(d.parentId !== undefined ? { parentId: d.parentId } : {}),
      ...(d.active !== undefined ? { active: d.active } : {}),
    },
  });

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'GEOGRAPHY_UPDATED',
    targetType: 'Geography',
    targetId: id,
    metadata: { changedKeys: Object.keys(req.body ?? {}) },
  });

  res.json(updated);
}));

export default router;
