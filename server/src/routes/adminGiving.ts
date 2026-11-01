import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { requireMember } from '../lib/memberAuth';
import { requireCsrf } from '../lib/csrf';
import { isCentralAdminPerson } from '../lib/centralAdmin';
import { leadershipMutationLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import { recordAudit } from '../lib/audit';
import { campaignReport, campaignsWithTotals, decideGift, givingSummary, waitingGifts } from '../lib/giving';

// Giving for the central admin: gifts waiting for confirmation, totals (overall,
// by kind, per assembly), help-one-another campaigns, and how to give. Offered
// twice — in the admin dashboard and in the central admin's own member profile
// — with the same rules. Leaders have no access to any of it.
type Actor = { id: string; email: string };

function buildGivingRouter(resolveActor: (req: Request) => Promise<Actor | null>) {
  const router = Router();

  router.get('/summary', asyncHandler(async (_req, res) => {
    res.json(await givingSummary());
  }));

  router.get('/waiting', asyncHandler(async (_req, res) => {
    res.json({ items: await waitingGifts() });
  }));

  router.post('/gifts/:id/decide', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const parsed = z.object({ decision: z.enum(['CONFIRM', 'REJECT']), note: z.string().trim().max(500).optional() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Confirm or reject.' });
    const actor = await resolveActor(req);
    if (!actor) return res.status(403).json({ error: 'Forbidden.' });
    const id = String(req.params.id);
    const result = await decideGift(id, parsed.data.decision, actor.id, parsed.data.note);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    await recordAudit({ actorId: actor.id, actorEmail: actor.email, action: result.status === 'CONFIRMED' ? 'GIFT_CONFIRMED' : 'GIFT_REJECTED', targetType: 'Gift', targetId: id });
    res.json({ status: result.status });
  }));

  router.get('/campaigns', asyncHandler(async (_req, res) => {
    res.json({ items: await campaignsWithTotals(false) });
  }));

  const campaignSchema = z.object({
    titleEn: z.string().trim().min(1).max(200),
    titleFr: z.string().trim().max(200).optional(),
    descriptionEn: z.string().trim().max(2000).optional(),
    descriptionFr: z.string().trim().max(2000).optional(),
    targetAmount: z.number().int().min(100).max(1_000_000_000).optional(),
  });
  router.post('/campaigns', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const parsed = campaignSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Give the campaign a title.' });
    const actor = await resolveActor(req);
    if (!actor) return res.status(403).json({ error: 'Forbidden.' });
    const d = parsed.data;
    const created = await prisma.giftCampaign.create({
      data: { titleEn: d.titleEn, titleFr: d.titleFr || null, descriptionEn: d.descriptionEn || null, descriptionFr: d.descriptionFr || null, targetAmount: d.targetAmount ?? null, createdByUserId: actor.id },
    });
    await recordAudit({ actorId: actor.id, actorEmail: actor.email, action: 'GIFT_CAMPAIGN_CREATED', targetType: 'GiftCampaign', targetId: created.id });
    res.status(201).json({ id: created.id });
  }));

  router.patch('/campaigns/:id/close', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const actor = await resolveActor(req);
    if (!actor) return res.status(403).json({ error: 'Forbidden.' });
    const id = String(req.params.id);
    const changed = await prisma.giftCampaign.updateMany({ where: { id, status: 'OPEN' }, data: { status: 'CLOSED', closedAt: new Date() } });
    if (changed.count === 0) return res.status(404).json({ error: 'No open campaign with this id.' });
    await recordAudit({ actorId: actor.id, actorEmail: actor.email, action: 'GIFT_CAMPAIGN_CLOSED', targetType: 'GiftCampaign', targetId: id });
    res.json({ status: 'CLOSED' });
  }));

  router.get('/campaigns/:id/report', asyncHandler(async (req, res) => {
    const report = await campaignReport(String(req.params.id));
    if (!report) return res.status(404).json({ error: 'Campaign not found.' });
    res.json(report);
  }));

  router.get('/instructions', asyncHandler(async (_req, res) => {
    const s = await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { givingInstructionsEn: true, givingInstructionsFr: true, givingWeeklyPost: true } });
    res.json({ en: s?.givingInstructionsEn ?? '', fr: s?.givingInstructionsFr ?? '', weeklyPost: s?.givingWeeklyPost ?? true });
  }));

  const instructionsSchema = z.object({ en: z.string().trim().max(3000), fr: z.string().trim().max(3000), weeklyPost: z.boolean() });
  router.put('/instructions', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const parsed = instructionsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid instructions.' });
    const actor = await resolveActor(req);
    if (!actor) return res.status(403).json({ error: 'Forbidden.' });
    const { en, fr, weeklyPost } = parsed.data;
    await prisma.settings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', givingInstructionsEn: en || null, givingInstructionsFr: fr || null, givingWeeklyPost: weeklyPost },
      update: { givingInstructionsEn: en || null, givingInstructionsFr: fr || null, givingWeeklyPost: weeklyPost },
    });
    await recordAudit({ actorId: actor.id, actorEmail: actor.email, action: 'GIVING_INSTRUCTIONS_UPDATED', targetType: 'Settings', targetId: 'singleton' });
    res.json({ en, fr, weeklyPost });
  }));

  return router;
}

export const adminGivingRoutes = (() => {
  const router = Router();
  router.use(requireAuth, requireRole('ADMIN'));
  router.use(buildGivingRouter(async (req) => (req.user ? { id: req.user.id, email: req.user.email } : null)));
  return router;
})();

export const memberCentralGivingRoutes = (() => {
  const router = Router();
  router.use(requireMember);
  router.use(
    asyncHandler(async (req, res, next) => {
      if (!(await isCentralAdminPerson(req.member!.personId))) return res.status(403).json({ error: 'Forbidden.' });
      next();
    }),
  );
  router.use(
    buildGivingRouter(async (req) => {
      const user = await prisma.user.findUnique({ where: { personId: req.member!.personId }, select: { id: true, email: true, role: true, active: true } });
      return user && user.role === 'ADMIN' && user.active ? { id: user.id, email: user.email } : null;
    }),
  );
  return router;
})();
