import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { requireCsrf } from '../lib/csrf';
import { recordAudit } from '../lib/audit';
import { leadershipMutationLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import { parsePagination, paginatedResult } from '../lib/pagination';
import { notifyRepresentationRequestDecided } from '../lib/notifications';

const router = Router();

// Admin review of Member-submitted Representation Requests (see
// RepresentationRequest model comment). A route here NEVER creates,
// updates, or ends a RoleAssignment or CommunityMembership — approving or
// declining a request only ever changes this request's own record, the
// same "decide, never appoint" boundary already established by
// adminOrganizationalLeadershipRecommendations.ts.
router.use(requireAuth, requireRole('ADMIN'));

const listQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'DECLINED']).optional(),
});

const includePerson = { person: { select: { id: true, name: true } } } as const;

router.get('/representation-requests', asyncHandler(async (req, res) => {
  const { page, pageSize, skip, take } = parsePagination(req);
  const q = listQuerySchema.parse(req.query);
  const where = q.status ? { status: q.status } : {};
  const [total, items] = await Promise.all([
    prisma.representationRequest.count({ where }),
    prisma.representationRequest.findMany({
      where,
      include: includePerson,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
  ]);
  res.json(paginatedResult(items, total, page, pageSize));
}));

const decisionSchema = z.object({ decisionNote: z.string().trim().max(500).optional() });

async function decide(id: string, status: 'APPROVED' | 'DECLINED', userId: string, decisionNote: string | undefined) {
  const result = await prisma.representationRequest.updateMany({
    where: { id, status: 'PENDING' },
    data: { status, decidedAt: new Date(), decidedByUserId: userId, decisionNote: decisionNote ?? null },
  });
  return result.count > 0;
}

router.patch('/representation-requests/:id/approve', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const parsed = decisionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request.' });
  const existing = await prisma.representationRequest.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Representation request not found.' });
  const ok = await decide(id, 'APPROVED', req.user!.id, parsed.data.decisionNote);
  if (!ok) return res.status(409).json({ error: 'This request has already been decided.' });
  await recordAudit({ actorId: req.user!.id, actorEmail: req.user!.email, action: 'REPRESENTATION_REQUEST_APPROVED', targetType: 'RepresentationRequest', targetId: id });
  const updated = await prisma.representationRequest.findUnique({ where: { id }, include: includePerson });
  await notifyRepresentationRequestDecided(updated!);
  res.json(updated);
}));

router.patch('/representation-requests/:id/decline', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const parsed = decisionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request.' });
  const existing = await prisma.representationRequest.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Representation request not found.' });
  const ok = await decide(id, 'DECLINED', req.user!.id, parsed.data.decisionNote);
  if (!ok) return res.status(409).json({ error: 'This request has already been decided.' });
  await recordAudit({ actorId: req.user!.id, actorEmail: req.user!.email, action: 'REPRESENTATION_REQUEST_DECLINED', targetType: 'RepresentationRequest', targetId: id });
  const updated = await prisma.representationRequest.findUnique({ where: { id }, include: includePerson });
  await notifyRepresentationRequestDecided(updated!);
  res.json(updated);
}));

export default router;
