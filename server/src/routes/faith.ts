import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { requireMember } from '../lib/memberAuth';
import { requireCsrf } from '../lib/csrf';
import { leadershipMutationLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import { recordAudit } from '../lib/audit';
import { addNote, faithJourney, leadersMaySee, listFaith, mayReadFaith, setConfirmed, viewerFromMember, type FaithFilter, type FaithViewer } from '../lib/faith';

// The faith journey: what people answered about their walk with Christ at the
// end of the Book 1 / Book 2 exams (see lib/faith.ts). The central admin reads
// everyone's; a leader reads the people of their own assemblies, only when the
// central admin has switched that on. Members never reach any of this.
// Two doors for the central admin (admin dashboard and his member profile),
// plus the leaders' door, which is the member door (every leader is a member).

type Resolve = (req: Request) => Promise<FaithViewer | null>;

function buildFaithRouter(resolve: Resolve) {
  const router = Router();

  // Who am I here, and is the leaders' switch on? (drives what the app shows)
  router.get('/access', asyncHandler(async (req, res) => {
    const viewer = await resolve(req);
    if (!viewer) return res.status(403).json({ error: 'Forbidden.' });
    const leadersSee = await leadersMaySee();
    res.json({ role: viewer.kind, leadersSee, canRead: viewer.kind === 'ADMIN' || leadersSee });
  }));

  router.get('/settings', asyncHandler(async (req, res) => {
    const viewer = await resolve(req);
    if (viewer?.kind !== 'ADMIN') return res.status(403).json({ error: 'Forbidden.' });
    res.json({ leadersSeeFaithJourney: await leadersMaySee() });
  }));

  router.put('/settings', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const viewer = await resolve(req);
    if (viewer?.kind !== 'ADMIN') return res.status(403).json({ error: 'Forbidden.' });
    const parsed = z.object({ leadersSeeFaithJourney: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid setting.' });
    await prisma.settings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', leadersSeeFaithJourney: parsed.data.leadersSeeFaithJourney },
      update: { leadersSeeFaithJourney: parsed.data.leadersSeeFaithJourney },
    });
    await recordAudit({ actorId: req.user?.id, action: 'FAITH_LEADERS_SWITCHED', targetType: 'Settings', targetId: 'singleton', metadata: { on: parsed.data.leadersSeeFaithJourney } });
    res.json({ leadersSeeFaithJourney: parsed.data.leadersSeeFaithJourney });
  }));

  router.get('/', asyncHandler(async (req, res) => {
    const viewer = await resolve(req);
    if (!viewer) return res.status(403).json({ error: 'Forbidden.' });
    const filter = (['ALL', 'NEEDS', 'BORN_AGAIN', 'CONFIRMED'] as const).includes(req.query.filter as FaithFilter) ? (req.query.filter as FaithFilter) : 'ALL';
    const search = typeof req.query.search === 'string' ? req.query.search.slice(0, 80) : undefined;
    res.json({ items: await listFaith(viewer, { filter, search }) });
  }));

  // Does this person have a journey I may read? (for the card on a person's profile)
  router.get('/:personId/exists', asyncHandler(async (req, res) => {
    const viewer = await resolve(req);
    if (!viewer || !(await mayReadFaith(viewer, req.params.personId))) return res.json({ exists: false });
    const record = await prisma.faithRecord.findUnique({ where: { personId: req.params.personId }, select: { status: true, confirmedAt: true } });
    res.json({ exists: Boolean(record), status: record?.status ?? null, confirmed: Boolean(record?.confirmedAt) });
  }));

  router.get('/:personId', asyncHandler(async (req, res) => {
    const viewer = await resolve(req);
    if (!viewer || !(await mayReadFaith(viewer, req.params.personId))) return res.status(404).json({ error: 'Not found.' });
    const journey = await faithJourney(req.params.personId);
    if (!journey) return res.status(404).json({ error: 'Not found.' });
    if (viewer.kind === 'LEADER') await recordAudit({ action: 'FAITH_VIEWED_BY_LEADER', targetType: 'Person', targetId: req.params.personId, metadata: { leaderPersonId: viewer.personId } });
    res.json(journey);
  }));

  router.post('/:personId/confirm', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const viewer = await resolve(req);
    if (!viewer || !(await mayReadFaith(viewer, req.params.personId))) return res.status(404).json({ error: 'Not found.' });
    const parsed = z.object({ confirmed: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request.' });
    if (!(await setConfirmed(req.params.personId, viewer, parsed.data.confirmed))) return res.status(404).json({ error: 'Not found.' });
    await recordAudit({ actorId: req.user?.id, action: 'FAITH_CONFIRMED', targetType: 'Person', targetId: req.params.personId, metadata: { confirmed: parsed.data.confirmed, by: viewer.name } });
    res.json(await faithJourney(req.params.personId));
  }));

  router.post('/:personId/notes', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const viewer = await resolve(req);
    if (!viewer || !(await mayReadFaith(viewer, req.params.personId))) return res.status(404).json({ error: 'Not found.' });
    const parsed = z.object({ text: z.string().trim().min(1).max(4000) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Please write the note.' });
    const exists = await prisma.person.findUnique({ where: { id: req.params.personId }, select: { id: true } });
    if (!exists) return res.status(404).json({ error: 'Not found.' });
    await addNote(req.params.personId, viewer, parsed.data.text);
    res.status(201).json(await faithJourney(req.params.personId));
  }));

  return router;
}

/** Admin dashboard door: the central admin's own sign-in. */
export const adminFaithRoutes = (() => {
  const router = Router();
  router.use(requireAuth, requireRole('ADMIN'));
  router.use(buildFaithRouter(async (req) => ({ kind: 'ADMIN', name: req.user!.name, personId: req.user!.personId ?? null })));
  return router;
})();

/** Member door: the central admin on his member profile, and leaders (when the switch is on). */
export const memberFaithRoutes = (() => {
  const router = Router();
  router.use(requireMember);
  router.use(buildFaithRouter(async (req) => viewerFromMember(req.member!.personId, req.member!.name)));
  return router;
})();
