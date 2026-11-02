import { Router } from 'express';
import { z } from 'zod';
import { requireMember } from '../lib/memberAuth';
import { requireCsrf } from '../lib/csrf';
import { asyncHandler } from '../lib/asyncHandler';
import { clinicResultsFor } from '../lib/clinicExams';
import { clinicBookSubscribed, setClinicBookSubscription } from '../lib/clinic';

// /api/member/clinic — the member's Dominion Clinic: the rhythm (a new topic
// every so often, an exam every so many days), every exam's score with the
// total, and whether they receive the monthly book (they can unsubscribe and
// subscribe again). Only the member's own data.
const router = Router();
router.use(requireMember);

router.get('/', asyncHandler(async (req, res) => {
  const personId = req.member!.personId;
  const [results, subscribed] = await Promise.all([clinicResultsFor(personId), clinicBookSubscribed(personId)]);
  res.json({ ...results, subscribed });
}));

router.put('/subscription', requireCsrf, asyncHandler(async (req, res) => {
  const parsed = z.object({ subscribed: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'subscribed must be true or false.' });
  await setClinicBookSubscription(req.member!.personId, parsed.data.subscribed);
  res.json({ subscribed: parsed.data.subscribed });
}));

export default router;
