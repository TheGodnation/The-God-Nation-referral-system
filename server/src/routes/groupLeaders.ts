import { Router, type Request } from 'express';
import { z } from 'zod';
import { requireMember } from '../lib/memberAuth';
import { requireCsrf } from '../lib/csrf';
import { leadershipMutationLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import { GroupLeaderError, appointGroupLeader, authorityOf, candidatesFor, groupsFor, type Authority } from '../lib/groupLeaders';

// Groups and their leaders: one door for the central admin (every group) and one for a representative (the groups of
// their own generation). Same screens, same rules; what is allowed is decided from who the person is.
function build(want: 'ADMIN' | 'REP') {
  const router = Router();
  router.use(requireMember);

  const authority = async (req: Request, res: any): Promise<Authority | null> => {
    const a = await authorityOf(req.member!.personId);
    if (!a || a.kind !== want) {
      res.status(403).json({ error: want === 'ADMIN' ? 'Forbidden.' : 'Only the representative of a generation can use this.' });
      return null;
    }
    return a;
  };

  router.get('/groups', asyncHandler(async (req, res) => {
    const a = await authority(req, res);
    if (!a) return;
    res.json({ items: await groupsFor(a) });
  }));

  router.get('/candidates', asyncHandler(async (req, res) => {
    const a = await authority(req, res);
    if (!a) return;
    res.json({ items: await candidatesFor(a, String(req.query.communityId ?? ''), String(req.query.search ?? '')) });
  }));

  router.post('/leader', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const a = await authority(req, res);
    if (!a) return;
    const parsed = z.object({ communityId: z.string().min(1), personId: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Choose the group and the person.' });
    const created = await appointGroupLeader(req.member!.personId, a, parsed.data.communityId, parsed.data.personId);
    res.status(201).json({ id: created.id });
  }));

  router.use((err: unknown, _req: Request, res: any, next: any) => {
    if (err instanceof GroupLeaderError) return res.status(err.status).json({ error: err.message });
    next(err);
  });
  return router;
}

export const memberCentralGroupsRoutes = build('ADMIN');
export const memberRepGroupsRoutes = build('REP');
