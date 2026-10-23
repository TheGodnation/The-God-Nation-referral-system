import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { requireCsrf } from '../lib/csrf';
import { parsePagination, paginatedResult } from '../lib/pagination';
import { recordAudit } from '../lib/audit';
import { leadershipMutationLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import { levelBelow, titleForLevel, getAreaAncestors, formatAreaPath } from '../lib/geographicAreas';
import { notifyAreaLeadershipAssigned } from '../lib/notifications';

const router = Router();

router.use(requireAuth, requireRole('ADMIN'));

// ---------------------------------------------------------------------------
// Geographical Leadership Directory — area tree (Admin-only). The tree's
// shape (Country -> Region -> Division -> Subdivision -> Quarter) is
// defined and changed only here; members only ever browse it read-only.
// ---------------------------------------------------------------------------

const listQuerySchema = z.object({
  search: z.string().trim().min(1).max(120).optional(),
  parentId: z.string().min(1).optional(),
});

// GET /api/admin/geographic-areas — two modes, mirroring adminCommunities:
// ?search= for a flat name match (picker use), otherwise the children of
// ?parentId (or every NATIONAL root when parentId is omitted) for tree
// browsing.
router.get('/geographic-areas', asyncHandler(async (req, res) => {
  const q = listQuerySchema.parse(req.query);

  if (q.search) {
    const matches = await prisma.geographicArea.findMany({
      where: { name: { contains: q.search, mode: 'insensitive' } },
      include: { parent: { select: { id: true, name: true } }, _count: { select: { children: true } } },
      take: 20,
      orderBy: { name: 'asc' },
    });
    return res.json({ items: matches });
  }

  const { page, pageSize, skip, take } = parsePagination(req);
  const where = { parentId: q.parentId ?? null };
  const [total, items] = await Promise.all([
    prisma.geographicArea.count({ where }),
    prisma.geographicArea.findMany({
      where,
      include: {
        parent: { select: { id: true, name: true } },
        _count: { select: { children: true } },
        leadershipAssignments: { where: { status: 'ACTIVE' }, include: { person: { select: { id: true, name: true } } } },
      },
      orderBy: { name: 'asc' },
      skip,
      take,
    }),
  ]);
  res.json(paginatedResult(items, total, page, pageSize));
}));

// GET /api/admin/geographic-areas/:id — one area's own detail: its ancestor
// path, its current active leader(s), and its children.
router.get('/geographic-areas/:id', asyncHandler(async (req, res) => {
  const area = await prisma.geographicArea.findUnique({
    where: { id: req.params.id },
    include: {
      leadershipAssignments: { where: { status: 'ACTIVE' }, include: { person: { select: { id: true, name: true } } } },
      children: { orderBy: { name: 'asc' }, select: { id: true, name: true, level: true } },
      _count: { select: { children: true } },
    },
  });
  if (!area) return res.status(404).json({ error: 'Area not found.' });
  const ancestors = await getAreaAncestors(area.id);
  res.json({ ...area, title: titleForLevel(area.level), path: formatAreaPath(area, ancestors), ancestors });
}));

const createSchema = z.object({
  parentId: z.string().min(1).nullable(),
  name: z.string().trim().min(1).max(120),
});

// POST /api/admin/geographic-areas — a node's level is always derived from
// its parent's (NATIONAL for a root, one step below the parent otherwise),
// never client-supplied — the same reason RoleAssignment never accepts a
// client-chosen title: a level/title must come from the tree structure
// itself, not from what Admin happens to type.
router.post('/geographic-areas', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid area.' });
  const { parentId, name } = parsed.data;

  let level: 'NATIONAL' | 'REGION' | 'DIVISION' | 'SUBDIVISION' | 'QUARTER';
  let country: string;

  if (!parentId) {
    level = 'NATIONAL';
    country = name;
  } else {
    const parent = await prisma.geographicArea.findUnique({ where: { id: parentId } });
    if (!parent) return res.status(400).json({ error: 'Parent area not found.' });
    const below = levelBelow(parent.level);
    if (!below) return res.status(400).json({ error: 'A Quarter is the deepest level — it cannot have sub-areas.' });
    level = below;
    country = parent.country;
  }

  const created = await prisma.geographicArea.create({ data: { parentId, name, level, country } });

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'GEOGRAPHIC_AREA_CREATED',
    targetType: 'GeographicArea',
    targetId: created.id,
    metadata: { name, level, parentId },
  });

  res.status(201).json({ ...created, title: titleForLevel(created.level) });
}));

const renameSchema = z.object({ name: z.string().trim().min(1).max(120) });

router.patch('/geographic-areas/:id', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = renameSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'A name is required.' });
  const existing = await prisma.geographicArea.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Area not found.' });

  const updated = await prisma.geographicArea.update({ where: { id: req.params.id }, data: { name: parsed.data.name } });
  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'GEOGRAPHIC_AREA_RENAMED',
    targetType: 'GeographicArea',
    targetId: updated.id,
    metadata: { name: updated.name },
  });
  res.json({ ...updated, title: titleForLevel(updated.level) });
}));

// DELETE /api/admin/geographic-areas/:id — only a leaf (no children) with
// no current ACTIVE leader. Ended assignments / already-decided requests
// for it are cascade-deleted along with it — their history has no
// remaining referent once the area itself is gone.
router.delete('/geographic-areas/:id', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const existing = await prisma.geographicArea.findUnique({
    where: { id },
    include: { _count: { select: { children: true } }, leadershipAssignments: { where: { status: 'ACTIVE' } } },
  });
  if (!existing) return res.status(404).json({ error: 'Area not found.' });
  if (existing._count.children > 0) return res.status(409).json({ error: 'Remove or move this area\'s sub-areas first.' });
  if (existing.leadershipAssignments.length > 0) return res.status(409).json({ error: 'End this area\'s current leadership assignment(s) first.' });

  await prisma.geographicArea.delete({ where: { id } });
  await recordAudit({ actorId: req.user!.id, actorEmail: req.user!.email, action: 'GEOGRAPHIC_AREA_DELETED', targetType: 'GeographicArea', targetId: id });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Area Leadership Assignments — "leader of this exact GeographicArea."
// Admin-only creation, exactly like RoleAssignment; never self-granted.
// ---------------------------------------------------------------------------

const listAssignmentsSchema = z.object({
  personId: z.string().min(1).optional(),
  areaId: z.string().min(1).optional(),
  status: z.enum(['ACTIVE', 'ENDED']).optional(),
});

router.get('/area-leadership-assignments', asyncHandler(async (req, res) => {
  const { page, pageSize, skip, take } = parsePagination(req);
  const q = listAssignmentsSchema.parse(req.query);
  const where: Prisma.AreaLeadershipAssignmentWhereInput = {
    ...(q.personId ? { personId: q.personId } : {}),
    ...(q.areaId ? { areaId: q.areaId } : {}),
    ...(q.status ? { status: q.status } : {}),
  };
  const [total, items] = await Promise.all([
    prisma.areaLeadershipAssignment.count({ where }),
    prisma.areaLeadershipAssignment.findMany({
      where,
      include: {
        person: { select: { id: true, name: true, whatsappNumber: true } },
        area: { select: { id: true, name: true, level: true } },
        assignedBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { assignedAt: 'desc' },
      skip,
      take,
    }),
  ]);
  res.json(paginatedResult(items, total, page, pageSize));
}));

const createAssignmentSchema = z.object({
  personId: z.string().min(1),
  areaId: z.string().min(1),
});

router.post('/area-leadership-assignments', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = createAssignmentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid assignment.' });
  const { personId, areaId } = parsed.data;

  const person = await prisma.person.findUnique({ where: { id: personId } });
  if (!person) return res.status(400).json({ error: 'Person not found.' });
  const area = await prisma.geographicArea.findUnique({ where: { id: areaId } });
  if (!area) return res.status(400).json({ error: 'Area not found.' });

  let created;
  try {
    created = await prisma.areaLeadershipAssignment.create({
      data: { personId, areaId, assignedByUserId: req.user!.id },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return res.status(409).json({ error: 'This Person already actively leads this Area.' });
    }
    throw err;
  }

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'AREA_LEADERSHIP_ASSIGNMENT_CREATED',
    targetType: 'AreaLeadershipAssignment',
    targetId: created.id,
    metadata: { personId, areaId },
  });

  const ancestors = await getAreaAncestors(areaId);
  await notifyAreaLeadershipAssigned({ id: created.id, personId, areaTitle: titleForLevel(area.level), areaPath: formatAreaPath(area, ancestors) });

  res.status(201).json(created);
}));

router.patch('/area-leadership-assignments/:id/end', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const assignment = await prisma.areaLeadershipAssignment.findUnique({ where: { id } });
  if (!assignment) return res.status(404).json({ error: 'Assignment not found.' });
  if (assignment.status === 'ENDED') return res.status(409).json({ error: 'This assignment has already ended.' });

  const updated = await prisma.areaLeadershipAssignment.update({ where: { id }, data: { status: 'ENDED', endedAt: new Date() } });
  await recordAudit({ actorId: req.user!.id, actorEmail: req.user!.email, action: 'AREA_LEADERSHIP_ASSIGNMENT_ENDED', targetType: 'AreaLeadershipAssignment', targetId: id });
  res.json(updated);
}));

export default router;
