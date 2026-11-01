import { Router } from 'express';
import { requireAuth, requireRole } from '../lib/auth';
import { requireCsrf } from '../lib/csrf';
import { leadershipMutationLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import { requireLinkedPerson } from '../lib/leadership';
import { leaderClinicStatus, leaderSendsBook } from '../lib/clinic';

// Dominion Clinic for a leader: this month's book, how many of their people
// already have it, and one tap to send it to the rest (a private message to each).
const router = Router();
router.use(requireAuth, requireRole('LEADER'), requireLinkedPerson);

router.get('/clinic', asyncHandler(async (req, res) => {
  res.json(await leaderClinicStatus(req.leaderPersonId!));
}));

router.post('/clinic/send', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const result = await leaderSendsBook(req.leaderPersonId!);
  if (!result) return res.status(404).json({ error: 'There is no Dominion Clinic book open right now.' });
  res.json(result);
}));

export default router;
