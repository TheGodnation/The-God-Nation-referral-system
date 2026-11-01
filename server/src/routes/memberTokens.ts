import { Router } from 'express';
import { requireMember } from '../lib/memberAuth';
import { asyncHandler } from '../lib/asyncHandler';
import { memberTokenView } from '../lib/tokens';

// /api/member/tokens — the member's own King's Tokens: balance, history, the
// foundation's balance, and the rate now. Only the member's own data.
const router = Router();
router.use(requireMember);

router.get('/', asyncHandler(async (req, res) => {
  res.json(await memberTokenView(req.member!.personId));
}));

export default router;
