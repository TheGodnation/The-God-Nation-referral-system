import { Router, type Request } from 'express';
import { z } from 'zod';
import { requireMember } from '../lib/memberAuth';
import { requireCsrf } from '../lib/csrf';
import { leadershipMutationLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import { recordAudit } from '../lib/audit';
import { prisma } from '../lib/prisma';
import { ScheduleError, approveScheduled, createScheduled, deleteScheduled, listScheduled, postScheduledNow, retryScheduledText, saveScheduledText, updateScheduled } from '../lib/scheduledTeachings';

// "Send later" for the central admin: record a teaching now, post it in a group at a time they choose. The recordings are uploaded
// the usual way for the group's chat (the same authorize step), then kept here instead of being sent at once.

const onError = (err: unknown, _req: Request, res: any, next: any) => {
  if (err instanceof ScheduleError) return res.status(err.status).json({ error: err.message, code: err.code });
  next(err);
};

const clipSchema = z.object({ language: z.enum(['en', 'fr']), storageKey: z.string().min(1).max(300), mimeType: z.string().min(1).max(100), byteSize: z.number().int().positive() });
const createSchema = z.object({ communityId: z.string().min(1), postAt: z.string().datetime(), liveTeaching: z.boolean().optional(), clips: z.array(clipSchema).min(1).max(2) });
const patchSchema = z.object({ postAt: z.string().datetime().optional(), liveTeaching: z.boolean().optional() });
const textSchema = z.object({ textEn: z.string().max(60000).optional(), textFr: z.string().max(60000).optional() });

export const memberScheduledTeachingsRoutes = (() => {
  const router = Router();
  router.use(requireMember);
  const me = (req: Request) => req.member!.personId;
  const audit = async (req: Request, action: string, targetId: string) => {
    const user = await prisma.user.findUnique({ where: { personId: me(req) }, select: { id: true, email: true } });
    if (user) await recordAudit({ actorId: user.id, actorEmail: user.email, action, targetType: 'ScheduledTeaching', targetId });
  };

  router.get('/', asyncHandler(async (req, res) => {
    res.json({ items: await listScheduled(me(req)) });
  }));
  router.post('/', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const p = createSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: 'Check the recording and the time.' });
    const made = await createScheduled(me(req), { communityId: p.data.communityId, postAt: new Date(p.data.postAt), liveTeaching: p.data.liveTeaching === true, clips: p.data.clips });
    await audit(req, 'TEACHING_SCHEDULED', made.id);
    res.status(201).json(made);
  }));
  router.patch('/:id', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const p = patchSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: 'Check the time.' });
    res.json(await updateScheduled(me(req), req.params.id, { postAt: p.data.postAt ? new Date(p.data.postAt) : undefined, liveTeaching: p.data.liveTeaching }));
  }));
  router.put('/:id/text', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const p = textSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: 'Check the text and try again.' });
    res.json(await saveScheduledText(me(req), req.params.id, p.data));
  }));
  router.post('/:id/approve', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    res.json(await approveScheduled(me(req), req.params.id));
  }));
  router.post('/:id/retry', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    res.json(await retryScheduledText(me(req), req.params.id));
  }));
  router.post('/:id/post-now', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const posted = await postScheduledNow(me(req), req.params.id);
    await audit(req, 'TEACHING_POSTED_NOW', req.params.id);
    res.json(posted);
  }));
  router.delete('/:id', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    await deleteScheduled(me(req), req.params.id);
    await audit(req, 'TEACHING_SCHEDULE_DELETED', req.params.id);
    res.json({ ok: true });
  }));
  router.use(onError);
  return router;
})();
