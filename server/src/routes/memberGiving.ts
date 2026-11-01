import { Router } from 'express';
import { z } from 'zod';
import { requireMember } from '../lib/memberAuth';
import { requireCsrf } from '../lib/csrf';
import { asyncHandler } from '../lib/asyncHandler';
import { socialMutationLimiter } from '../lib/rateLimit';
import { GIFT_KINDS, MAX_GIFT, MIN_GIFT, campaignReport, campaignsWithTotals, createGift, givingInstructions, myGifts } from '../lib/giving';

// /api/member/giving — what a member needs to give: how to give, the open
// help-one-another campaigns, saying "I have given", their own gifts, and a
// campaign's public report. A member only ever sees their own gifts; leaders
// have no access to anyone's gifts.
const router = Router();
router.use(requireMember);

router.get('/info', asyncHandler(async (req, res) => {
  const personId = req.member!.personId;
  const [instructions, campaigns, mine] = await Promise.all([
    givingInstructions(req.member!.preferredLanguage === 'fr' ? 'fr' : 'en'),
    campaignsWithTotals(true),
    myGifts(personId),
  ]);
  res.json({ instructions, minimum: MIN_GIFT, maximum: MAX_GIFT, campaigns, mine });
}));

const giftSchema = z.object({
  kind: z.enum(GIFT_KINDS as [string, ...string[]]),
  campaignId: z.string().min(1).optional(),
  amount: z.number().int(),
  reference: z.string().trim().min(3).max(100),
  payerPhone: z.string().trim().max(30).optional(),
  anonymous: z.boolean().optional(),
});

router.post('/gifts', socialMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = giftSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Give the amount and the transaction ID.' });
  const result = await createGift({ personId: req.member!.personId, ...parsed.data, kind: parsed.data.kind as (typeof GIFT_KINDS)[number] });
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.status(201).json({ id: result.id });
}));

router.get('/campaigns/:id/report', asyncHandler(async (req, res) => {
  const report = await campaignReport(String(req.params.id));
  if (!report) return res.status(404).json({ error: 'Campaign not found.' });
  res.json(report);
}));

export default router;
