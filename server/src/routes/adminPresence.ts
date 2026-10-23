import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { asyncHandler } from '../lib/asyncHandler';
import { ONLINE_WINDOW_MS } from '../lib/presence';

// GET /api/admin/presence — how many people have the app open right now,
// across the whole app and for each group (admin dashboard "Online now").
const router = Router();
router.use(requireAuth, requireRole('ADMIN'));

router.get('/', asyncHandler(async (_req, res) => {
  const since = new Date(Date.now() - ONLINE_WINDOW_MS);
  const [onlineNow, communities, onlineMemberships] = await Promise.all([
    prisma.person.count({ where: { lastSeenAt: { gte: since } } }),
    prisma.community.findMany({
      select: { id: true, name: true, _count: { select: { memberships: { where: { status: 'ACTIVE' } } } } },
      orderBy: { name: 'asc' },
    }),
    prisma.communityMembership.findMany({
      where: { status: 'ACTIVE', person: { lastSeenAt: { gte: since } } },
      select: { communityId: true },
    }),
  ]);
  const onlineByGroup = new Map<string, number>();
  for (const m of onlineMemberships) onlineByGroup.set(m.communityId, (onlineByGroup.get(m.communityId) ?? 0) + 1);
  res.json({
    onlineNow,
    groups: communities
      .map((c) => ({ communityId: c.id, name: c.name, memberCount: c._count.memberships, onlineCount: onlineByGroup.get(c.id) ?? 0 }))
      .sort((a, b) => b.onlineCount - a.onlineCount || a.name.localeCompare(b.name)),
  });
}));

export default router;
