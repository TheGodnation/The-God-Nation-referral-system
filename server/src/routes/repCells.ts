import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireMember } from '../lib/memberAuth';
import { requireCsrf } from '../lib/csrf';
import { leadershipMutationLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import { recordAudit } from '../lib/audit';
import { assembliesOverview } from '../lib/cells';
import { leaderLoads, shareUnassigned } from '../lib/followUpShare';
import { actingUserFor, representedCommunityIds, representedGeneration } from '../lib/representatives';

// The representative of a generation gives the people nobody follows yet to the leaders of an assembly of THEIR
// generation — the same tool the central admin has (same rules, same preview), limited to that generation.
// Every route below refuses an assembly outside it.

const router = Router();
router.use(requireMember);

async function scope(req: Request, res: Response): Promise<{ generation: number; ids: Set<string> } | null> {
  const generation = await representedGeneration(req.member!.personId);
  if (generation === null) {
    res.status(403).json({ error: 'Only the representative of a generation can use this.' });
    return null;
  }
  return { generation, ids: new Set(await representedCommunityIds(req.member!.personId)) };
}

router.get('/overview', asyncHandler(async (req, res) => {
  const s = await scope(req, res);
  if (!s) return;
  const all = await assembliesOverview();
  res.json({ generation: s.generation, items: all.items.filter((r) => s.ids.has(r.id)) });
}));

router.get('/leaders', asyncHandler(async (req, res) => {
  const s = await scope(req, res);
  if (!s) return;
  const communityId = z.string().min(1).safeParse(req.query.communityId);
  if (!communityId.success) return res.status(400).json({ error: 'communityId is required.' });
  if (!s.ids.has(communityId.data)) return res.status(403).json({ error: 'This assembly is not in your generation.' });
  res.json({ items: await leaderLoads(communityId.data) });
}));

router.post('/share', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const s = await scope(req, res);
  if (!s) return;
  const parsed = z
    .object({
      communityId: z.string().min(1),
      leaderPersonIds: z.array(z.string().min(1)).max(500).optional(),
      perLeader: z.number().int().min(1).max(2000).optional(),
      dryRun: z.boolean().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'communityId is required.' });
  const { communityId, ...options } = parsed.data;
  if (!s.ids.has(communityId)) return res.status(403).json({ error: 'This assembly is not in your generation.' });
  const user = await actingUserFor(req.member!.personId);
  const result = await shareUnassigned(communityId, user.id, options);
  if (!result.dryRun) {
    await recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: 'FOLLOW_UP_BULK_DISTRIBUTED',
      targetType: 'Community',
      targetId: communityId,
      metadata: { actorPersonId: req.member!.personId, via: 'representative', generation: s.generation, totalAssigned: result.assigned, remaining: result.remaining, perLeader: options.perLeader ?? null, chosenLeaders: options.leaderPersonIds?.length ?? null },
    });
  }
  res.json(result);
}));

export const memberRepCellsRoutes = router;
