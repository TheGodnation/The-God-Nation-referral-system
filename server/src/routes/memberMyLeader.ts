import { Router } from 'express';
import { requireMember } from '../lib/memberAuth';
import { requireCsrf } from '../lib/csrf';
import { asyncHandler } from '../lib/asyncHandler';
import { leadershipMutationLimiter } from '../lib/rateLimit';
import { introducePendingAssignments, myLeaderOf } from '../lib/leaderIntro';

// "Your leader": the leader the signed-in person has been told about (GET), and the leader's own call, made when
// they open their dashboard, that tells the people newly assigned to them who their leader is (POST /introduce).
const router = Router();
router.use(requireMember);

router.get('/', asyncHandler(async (req, res) => {
  res.json({ leader: await myLeaderOf(req.member!.personId) });
}));

router.post('/introduce', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  res.json({ told: await introducePendingAssignments(req.member!.personId) });
}));

export default router;
