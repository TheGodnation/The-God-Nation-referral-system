import { Router } from 'express';
import { requireMember } from '../lib/memberAuth';
import { asyncHandler } from '../lib/asyncHandler';
import { clinicResultsFor } from '../lib/clinicExams';

// /api/member/clinic — the member's Dominion Clinic: the rhythm (a new topic
// every so often, an exam every so many days) and every exam's score with the
// total. Only the member's own results.
const router = Router();
router.use(requireMember);

router.get('/', asyncHandler(async (req, res) => {
  res.json(await clinicResultsFor(req.member!.personId));
}));

export default router;
