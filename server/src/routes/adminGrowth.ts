import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../lib/auth';
import { requireMember } from '../lib/memberAuth';
import { isCentralAdminPerson } from '../lib/centralAdmin';
import { asyncHandler } from '../lib/asyncHandler';
import { growthReport } from '../lib/growthReport';

// The growth report, for the central admin: in the admin dashboard and in
// their own member profile (same numbers). Read-only.
const querySchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

function build() {
  const router = Router();
  router.get('/', asyncHandler(async (req, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'days must be from 1 to 365.' });
    res.json(await growthReport(parsed.data.days));
  }));
  return router;
}

export const adminGrowthRoutes = (() => {
  const router = Router();
  router.use(requireAuth, requireRole('ADMIN'));
  router.use(build());
  return router;
})();

export const memberCentralGrowthRoutes = (() => {
  const router = Router();
  router.use(requireMember);
  router.use(
    asyncHandler(async (req, res, next) => {
      if (!(await isCentralAdminPerson(req.member!.personId))) return res.status(403).json({ error: 'Forbidden.' });
      next();
    }),
  );
  router.use(build());
  return router;
})();
