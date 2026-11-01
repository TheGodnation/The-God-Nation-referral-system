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
import { addEscalationMessage, escalationViewFor, escalationsForAdmin, type EscalationActor } from '../lib/escalations';
import { handOverPeople, leaderLoads, shareUnassigned } from '../lib/followUpShare';
import { appointLeader, assembliesOverview, readyToLeadIn } from '../lib/cells';

// Cells for the central admin: every assembly with its size, leaders and
// how many are ready to lead; the "Ready to lead" list of one assembly; and
// one-tap appointment. The SAME three endpoints are offered twice: in the
// admin dashboard (admin sign-in) and in the central admin's own member
// profile (member sign-in) — one set of rules, so they never disagree.
type Actor = { id: string; email: string; personId?: string | null };

function buildCellsRouter(resolveActor: (req: Request) => Promise<Actor | null>) {
  const router = Router();

  router.get('/overview', asyncHandler(async (_req, res) => {
    res.json(await assembliesOverview());
  }));

  router.get('/ready-to-lead', asyncHandler(async (req, res) => {
    const communityId = z.string().min(1).safeParse(req.query.communityId);
    if (!communityId.success) return res.status(400).json({ error: 'communityId is required.' });
    res.json(await readyToLeadIn(communityId.data));
  }));

  const appointSchema = z.object({ personId: z.string().min(1), communityId: z.string().min(1) });
  router.post('/appoint', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const parsed = appointSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'personId and communityId are required.' });
    const actor = await resolveActor(req);
    if (!actor) return res.status(403).json({ error: 'Forbidden.' });
    const result = await appointLeader(parsed.data.personId, parsed.data.communityId, actor);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.status(201).json({ id: result.id });
  }));

  // Give the people nobody follows yet to the assembly's leaders, evenly by headcount.
  router.post('/share', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const parsed = z.object({ communityId: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'communityId is required.' });
    const actor = await resolveActor(req);
    if (!actor) return res.status(403).json({ error: 'Forbidden.' });
    const result = await shareUnassigned(parsed.data.communityId, actor.id);
    await recordAudit({ actorId: actor.id, actorEmail: actor.email, action: 'FOLLOW_UP_BULK_DISTRIBUTED', targetType: 'Community', targetId: parsed.data.communityId, metadata: { totalAssigned: result.assigned, via: 'share-by-headcount' } });
    res.json(result);
  }));

  // The leaders of one assembly with how many people each follows and who is away.
  router.get('/leaders', asyncHandler(async (req, res) => {
    const communityId = z.string().min(1).safeParse(req.query.communityId);
    if (!communityId.success) return res.status(400).json({ error: 'communityId is required.' });
    res.json({ items: await leaderLoads(communityId.data) });
  }));

  // Hand every person (or the people of a leader in one assembly) to another leader, records and chat with them.
  router.post('/handover', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const parsed = z
      .object({ fromLeaderPersonId: z.string().min(1), communityId: z.string().min(1), toLeaderPersonId: z.string().min(1).optional() })
      .safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'fromLeaderPersonId and communityId are required.' });
    const actor = await resolveActor(req);
    if (!actor) return res.status(403).json({ error: 'Forbidden.' });
    const result = await handOverPeople({ ...parsed.data, fromLeaderId: parsed.data.fromLeaderPersonId, toLeaderId: parsed.data.toLeaderPersonId, actorUserId: actor.id });
    await recordAudit({ actorId: actor.id, actorEmail: actor.email, action: 'FOLLOW_UP_REASSIGNED', targetType: 'Community', targetId: parsed.data.communityId, metadata: { ...result, fromLeaderPersonId: parsed.data.fromLeaderPersonId, via: 'handover' } });
    res.json(result);
  }));

  // Hard questions from leaders: everything open or recent, one thread, and a reply.
  const asEscalationActor = (a: Actor): EscalationActor => ({ kind: 'ADMIN', userId: a.id, personId: a.personId ?? null });

  router.get('/escalations', asyncHandler(async (req, res) => {
    const actor = await resolveActor(req);
    if (!actor) return res.status(403).json({ error: 'Forbidden.' });
    res.json({ items: await escalationsForAdmin(asEscalationActor(actor)) });
  }));

  router.post('/escalations/:id/messages', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const parsed = z.object({ body: z.string().trim().min(1).max(4000) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Write a reply.' });
    const actor = await resolveActor(req);
    if (!actor) return res.status(403).json({ error: 'Forbidden.' });
    const id = String(req.params.id);
    const result = await addEscalationMessage(id, asEscalationActor(actor), parsed.data.body);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.status(201).json({ item: await escalationViewFor(id, asEscalationActor(actor)) });
  }));

  // The size of an assembly: when it is reached, newcomers go to a new assembly.
  const capacitySchema = z.object({ assemblyCapacity: z.number().int().min(10).max(5000) });
  router.put('/capacity', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const parsed = capacitySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'assemblyCapacity must be a whole number from 10 to 5000.' });
    const actor = await resolveActor(req);
    if (!actor) return res.status(403).json({ error: 'Forbidden.' });
    const { assemblyCapacity } = parsed.data;
    await prisma.settings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', assemblyCapacity },
      update: { assemblyCapacity },
    });
    await recordAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'PLACEMENT_MODE_UPDATED',
      targetType: 'Settings',
      targetId: 'singleton',
      metadata: { assemblyCapacity },
    });
    res.json({ assemblyCapacity });
  }));

  return router;
}

// Admin dashboard (admin sign-in).
export const adminCellsRoutes = (() => {
  const router = Router();
  router.use(requireAuth, requireRole('ADMIN'));
  router.use(buildCellsRouter(async (req) => (req.user ? { id: req.user.id, email: req.user.email, personId: req.user.personId ?? null } : null)));
  return router;
})();

// The central admin's own member profile (member sign-in).
export const memberCentralCellsRoutes = (() => {
  const router = Router();
  router.use(requireMember);
  router.use(
    asyncHandler(async (req, res, next) => {
      if (!(await isCentralAdminPerson(req.member!.personId))) return res.status(403).json({ error: 'Forbidden.' });
      next();
    }),
  );
  router.use(
    buildCellsRouter(async (req) => {
      const user = await prisma.user.findUnique({ where: { personId: req.member!.personId }, select: { id: true, email: true, role: true, active: true } });
      return user && user.role === 'ADMIN' && user.active ? { id: user.id, email: user.email, personId: req.member!.personId } : null;
    }),
  );
  return router;
})();
