import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { requireCsrf } from '../lib/csrf';
import { recordAudit } from '../lib/audit';
import { leadershipMutationLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import { grantResourceAccess } from '../lib/resourceAccess';
import { notifyResourceGranted } from '../lib/notifications';

const router = Router();

// Admin (Central Authority) only — granting/revoking a specific Person's
// access to a specific Resource. Mounted at '/api/admin' root (same
// multi-file-sharing-one-prefix pattern as adminPeopleRoutes/
// adminAttemptsRoutes/adminLeadershipRoutes), so this file's own routes
// read as an extension of the existing People management surface rather
// than a competing one. Never allows a Leader or ordinary Member to grant
// or revoke — only requireRole('ADMIN'), exactly like every other
// Admin-only mutation in this codebase.
router.use(requireAuth, requireRole('ADMIN'));

const grantResponseInclude = {
  resource: { select: { id: true, titleEn: true, titleFr: true, active: true } },
} as const;

function toGrantResponse(g: {
  id: string;
  status: 'ACTIVE' | 'REVOKED';
  grantedAt: Date;
  revokedAt: Date | null;
  resource: { id: string; titleEn: string; titleFr: string | null; active: boolean };
}) {
  return {
    id: g.id,
    status: g.status,
    grantedAt: g.grantedAt,
    revokedAt: g.revokedAt,
    resource: g.resource,
  };
}

// GET /api/admin/people/:personId/resource-access — every grant (ACTIVE or
// REVOKED — history stays visible to the Admin, only member-facing routes
// hide a revoked grant) for this exact Person. Never a per-Resource
// recipient list in the other direction — this phase has no "who has
// access to Resource X" endpoint, matching the task's own minimal-CRUD
// instruction.
router.get('/people/:personId/resource-access', asyncHandler(async (req, res) => {
  const { personId } = req.params;
  const person = await prisma.person.findUnique({ where: { id: personId }, select: { id: true } });
  if (!person) return res.status(404).json({ error: 'Person not found.' });

  const grants = await prisma.resourceAccessGrant.findMany({
    where: { personId },
    include: grantResponseInclude,
    orderBy: { grantedAt: 'desc' },
  });

  res.json({ items: grants.map(toGrantResponse) });
}));

const grantSchema = z.object({ resourceId: z.string().min(1) });

// POST /api/admin/people/:personId/resource-access — grants (or re-grants
// after a prior revocation) resourceId to personId. grantedByUserId is
// always req.user!.id, never accepted from the request body.
router.post('/people/:personId/resource-access', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const { personId } = req.params;
  const parsed = grantSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'A resourceId is required.' });
  }

  const [person, resource] = await Promise.all([
    prisma.person.findUnique({ where: { id: personId }, select: { id: true } }),
    prisma.resource.findUnique({ where: { id: parsed.data.resourceId } }),
  ]);
  if (!person) return res.status(404).json({ error: 'Person not found.' });
  if (!resource) return res.status(400).json({ error: 'Resource not found.' });

  const { grant, wasNewlyActivated } = await grantResourceAccess(personId, resource.id, req.user!.id);

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'RESOURCE_ACCESS_GRANTED',
    targetType: 'ResourceAccessGrant',
    targetId: grant.id,
    metadata: { personId, resourceId: resource.id },
  });

  if (wasNewlyActivated) {
    await notifyResourceGranted(grant);
  }

  res.status(201).json(toGrantResponse({ ...grant, resource }));
}));

// PATCH /api/admin/resource-access/:grantId/revoke — revokes an ACTIVE
// grant. Atomic compare-and-swap on status = 'ACTIVE', mirroring the
// publish/archive/end atomicity convention used across this codebase
// (Announcement.publish, HeadquartersPost.publish, RoleAssignment.end).
router.patch('/resource-access/:grantId/revoke', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const { grantId } = req.params;

  const existing = await prisma.resourceAccessGrant.findUnique({ where: { id: grantId } });
  if (!existing) return res.status(404).json({ error: 'Resource access grant not found.' });
  if (existing.status !== 'ACTIVE') {
    return res.status(409).json({ error: 'This grant is already revoked.' });
  }

  const result = await prisma.resourceAccessGrant.updateMany({
    where: { id: grantId, status: 'ACTIVE' },
    data: { status: 'REVOKED', revokedAt: new Date(), revokedByUserId: req.user!.id },
  });
  if (result.count !== 1) {
    return res.status(409).json({ error: 'This grant is already revoked.' });
  }

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'RESOURCE_ACCESS_REVOKED',
    targetType: 'ResourceAccessGrant',
    targetId: grantId,
    metadata: { personId: existing.personId, resourceId: existing.resourceId },
  });

  const updated = await prisma.resourceAccessGrant.findUnique({ where: { id: grantId }, include: grantResponseInclude });
  res.json(toGrantResponse(updated!));
}));

export default router;
