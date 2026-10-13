import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { requireCsrf } from '../lib/csrf';
import { recordAudit } from '../lib/audit';
import { leadershipMutationLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import { parsePagination, paginatedResult } from '../lib/pagination';
import { titleForLevel, getAreaAncestors, formatAreaPath } from '../lib/geographicAreas';
import { notifyAreaLeadershipAssigned, notifyAreaRepresentationRequestDeclined } from '../lib/notifications';

const router = Router();

// Admin review of Member-submitted AreaRepresentationRequests. Unlike
// RepresentationRequest's deliberate "decide, never appoint" boundary,
// approving one of THESE requests is the appointment itself: it creates the
// AreaLeadershipAssignment directly (see schema comment on
// AreaRepresentationRequest for why that's the intended difference).
// Submitting a request still never grants anything by itself — only this
// route's own approve action does.
router.use(requireAuth, requireRole('ADMIN'));

const listQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'DECLINED']).optional(),
});

const includePersonAndArea = {
  person: { select: { id: true, name: true } },
  area: { select: { id: true, name: true, level: true } },
} as const;

router.get('/area-representation-requests', asyncHandler(async (req, res) => {
  const { page, pageSize, skip, take } = parsePagination(req);
  const q = listQuerySchema.parse(req.query);
  const where = q.status ? { status: q.status } : {};
  const [total, items] = await Promise.all([
    prisma.areaRepresentationRequest.count({ where }),
    prisma.areaRepresentationRequest.findMany({
      where,
      include: includePersonAndArea,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
  ]);
  res.json(paginatedResult(items, total, page, pageSize));
}));

const decisionSchema = z.object({ decisionNote: z.string().trim().max(500).optional() });

router.patch('/area-representation-requests/:id/approve', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const parsed = decisionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request.' });

  const existing = await prisma.areaRepresentationRequest.findUnique({ where: { id }, include: { area: true } });
  if (!existing) return res.status(404).json({ error: 'Representation request not found.' });
  if (existing.status !== 'PENDING') return res.status(409).json({ error: 'This request has already been decided.' });

  let assignment;
  try {
    assignment = await prisma.areaLeadershipAssignment.create({
      data: { personId: existing.personId, areaId: existing.areaId, assignedByUserId: req.user!.id },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return res.status(409).json({ error: 'This Person already actively leads this Area.' });
    }
    throw err;
  }

  const result = await prisma.areaRepresentationRequest.updateMany({
    where: { id, status: 'PENDING' },
    data: { status: 'APPROVED', decidedAt: new Date(), decidedByUserId: req.user!.id, decisionNote: parsed.data.decisionNote ?? null },
  });
  if (result.count === 0) return res.status(409).json({ error: 'This request has already been decided.' });

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'AREA_REPRESENTATION_REQUEST_APPROVED',
    targetType: 'AreaRepresentationRequest',
    targetId: id,
    metadata: { personId: existing.personId, areaId: existing.areaId, areaLeadershipAssignmentId: assignment.id },
  });

  const ancestors = await getAreaAncestors(existing.areaId);
  await notifyAreaLeadershipAssigned({
    id: assignment.id,
    personId: existing.personId,
    areaTitle: titleForLevel(existing.area.level),
    areaPath: formatAreaPath(existing.area, ancestors),
  });

  const updated = await prisma.areaRepresentationRequest.findUnique({ where: { id }, include: includePersonAndArea });
  res.json({ ...updated, areaLeadershipAssignmentId: assignment.id });
}));

router.patch('/area-representation-requests/:id/decline', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const parsed = decisionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request.' });

  const existing = await prisma.areaRepresentationRequest.findUnique({ where: { id }, include: { area: true } });
  if (!existing) return res.status(404).json({ error: 'Representation request not found.' });

  const result = await prisma.areaRepresentationRequest.updateMany({
    where: { id, status: 'PENDING' },
    data: { status: 'DECLINED', decidedAt: new Date(), decidedByUserId: req.user!.id, decisionNote: parsed.data.decisionNote ?? null },
  });
  if (result.count === 0) return res.status(409).json({ error: 'This request has already been decided.' });

  await recordAudit({ actorId: req.user!.id, actorEmail: req.user!.email, action: 'AREA_REPRESENTATION_REQUEST_DECLINED', targetType: 'AreaRepresentationRequest', targetId: id });

  const ancestors = await getAreaAncestors(existing.areaId);
  await notifyAreaRepresentationRequestDeclined({ id, personId: existing.personId, areaPath: formatAreaPath(existing.area, ancestors) });

  const updated = await prisma.areaRepresentationRequest.findUnique({ where: { id }, include: includePersonAndArea });
  res.json(updated);
}));

export default router;
