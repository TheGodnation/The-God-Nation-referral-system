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
import {
  MUTE_DAYS,
  SanctionError,
  adminRemove,
  assembliesFor,
  decideRemoval,
  liftMute,
  listRemovalRequests,
  listSanctions,
  membersFor,
  placeMute,
  requestRemoval,
  sendExcuse,
} from '../lib/sanctions';

// Sanctions (mutes and removal requests). The same handlers serve the admin dashboard (admin session, which
// must be linked to a member profile) and the Member app (leaders, and the central admin's own profile).
// What a person may do is decided by lib/sanctions.ts from who they are in each assembly, never by the URL.

const muteSchema = z.object({
  communityId: z.string().min(1),
  personId: z.string().min(1),
  days: z.number().int(),
  reason: z.string().max(2000),
});
const removalSchema = z.object({ communityId: z.string().min(1), personId: z.string().min(1), reason: z.string().max(2000) });
const adminRemoveSchema = z.object({ communityId: z.string().min(1), personId: z.string().min(1) });
const decideSchema = z.object({ approve: z.boolean(), note: z.string().max(1000).optional().nullable() });

async function actorUser(personId: string) {
  return prisma.user.findUnique({ where: { personId }, select: { id: true, email: true, role: true, active: true } });
}

function build(resolvePersonId: (req: Request) => string | null) {
  const router = Router();

  const person = (req: Request) => {
    const id = resolvePersonId(req);
    if (!id) throw new SanctionError('Your account has no member profile, so this cannot be used here.', 409);
    return id;
  };
  const audit = async (req: Request, action: string, targetId: string, metadata: Record<string, unknown>) => {
    const personId = resolvePersonId(req);
    const user = personId ? await actorUser(personId) : null;
    await recordAudit({ actorId: user?.id ?? null, actorEmail: user?.email ?? null, action, targetType: 'MemberSanction', targetId, metadata: { actorPersonId: personId, ...metadata } });
  };

  router.get('/overview', asyncHandler(async (req, res) => {
    const me = person(req);
    res.json({
      durations: MUTE_DAYS,
      isCentralAdmin: await isCentralAdminPerson(me),
      sanctions: await listSanctions(me),
      removalRequests: await listRemovalRequests(me),
    });
  }));

  router.get('/assemblies', asyncHandler(async (req, res) => {
    res.json({ items: await assembliesFor(person(req), String(req.query.search ?? '')) });
  }));

  router.get('/members', asyncHandler(async (req, res) => {
    res.json({ items: await membersFor(person(req), String(req.query.communityId ?? ''), String(req.query.search ?? '')) });
  }));

  router.post('/mute', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const parsed = muteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Choose the assembly, the person, the number of days and give a reason.' });
    const result = await placeMute({ actorPersonId: person(req), ...parsed.data });
    await audit(req, 'MEMBER_MUTED', result.sanction.id, { communityId: parsed.data.communityId, personId: parsed.data.personId, days: parsed.data.days, reason: result.sanction.reason });
    res.status(201).json({ id: result.sanction.id, endsAt: result.sanction.endsAt });
  }));

  router.post('/:id/lift', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const result = await liftMute(String(req.params.id), person(req));
    await audit(req, 'MEMBER_MUTE_LIFTED', result.sanction.id, { communityId: result.sanction.communityId, personId: result.sanction.personId });
    res.json({ ok: true });
  }));

  router.post('/removal-requests', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const parsed = removalSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Choose the assembly and the person and give a reason.' });
    const request = await requestRemoval({ actorPersonId: person(req), ...parsed.data });
    await audit(req, 'REMOVAL_REQUESTED', request.id, { communityId: parsed.data.communityId, personId: parsed.data.personId });
    res.status(201).json({ id: request.id });
  }));

  router.post('/removal-requests/:id/decide', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const me = person(req);
    if (!(await isCentralAdminPerson(me))) throw new SanctionError('Only the central admin decides removal requests.', 403);
    const parsed = decideSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Say whether to approve or decline.' });
    const user = await actorUser(me);
    const result = await decideRemoval(String(req.params.id), parsed.data.approve, parsed.data.note ?? null, user?.id ?? null);
    await audit(req, result.approved ? 'REMOVAL_APPROVED' : 'REMOVAL_DECLINED', String(req.params.id), { personName: result.personName, assemblyName: result.assemblyName });
    res.json(result);
  }));

  router.post('/remove', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const parsed = adminRemoveSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Choose the assembly and the person.' });
    const result = await adminRemove(person(req), parsed.data.communityId, parsed.data.personId);
    await audit(req, 'MEMBER_REMOVED_FROM_ASSEMBLY', parsed.data.personId, { communityId: parsed.data.communityId, assemblyName: result.assemblyName });
    res.json({ ok: true });
  }));

  router.use((err: unknown, _req: Request, res: any, next: any) => {
    if (err instanceof SanctionError) return res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
    next(err);
  });
  return router;
}

export const adminSanctionsRoutes = (() => {
  const router = Router();
  router.use(requireAuth, requireRole('ADMIN'));
  router.use(build((req) => req.user?.personId ?? null));
  return router;
})();

export const memberSanctionsRoutes = (() => {
  const router = Router();
  router.use(requireMember);

  // The person's own mutes (to show where it applies) and their request for excuse.
  router.get('/mine', asyncHandler(async (req, res) => {
    const rows = await prisma.memberSanction.findMany({
      where: { personId: req.member!.personId, liftedAt: null, endsAt: { gt: new Date() } },
      include: { community: { select: { name: true } } },
      orderBy: { endsAt: 'desc' },
    });
    res.json({ items: rows.map((m) => ({ id: m.id, communityId: m.communityId, assemblyName: m.community.name, reason: m.reason, endsAt: m.endsAt, excuseSent: Boolean(m.excuseAt) })) });
  }));

  router.post('/:id/excuse', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const parsed = z.object({ message: z.string().max(2000) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Please write a few words.' });
    try {
      await sendExcuse(req.member!.personId, String(req.params.id), parsed.data.message);
    } catch (err) {
      if (err instanceof SanctionError) return res.status(err.status).json({ error: err.message });
      throw err;
    }
    res.json({ ok: true });
  }));

  router.use(build((req) => req.member?.personId ?? null));
  return router;
})();
