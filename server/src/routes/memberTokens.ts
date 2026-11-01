import { Router } from 'express';
import { requireMember } from '../lib/memberAuth';
import { asyncHandler } from '../lib/asyncHandler';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { memberTokenView } from '../lib/tokens';
import { spendQuote } from '../lib/tokenSpend';

// /api/member/tokens — the member's own King's Tokens: balance, history, the
// foundation's balance, and the rate now. Only the member's own data.
const router = Router();
router.use(requireMember);

router.get('/', asyncHandler(async (req, res) => {
  res.json(await memberTokenView(req.member!.personId));
}));

// What the member could use toward `count` books right now (nothing while spending is switched off).
router.get('/spend-quote', asyncHandler(async (req, res) => {
  const count = z.coerce.number().int().min(1).max(100).safeParse(req.query.count ?? 1);
  if (!count.success) return res.status(400).json({ error: 'count must be a whole number from 1 to 100.' });
  const settings = await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { trainingBookPrice: true } });
  res.json(await spendQuote(req.member!.personId, settings?.trainingBookPrice ?? 1200, count.data));
}));

export default router;
