import { Router, type Request } from 'express';
import { z } from 'zod';
import { requireMember } from '../lib/memberAuth';
import { requireCsrf } from '../lib/csrf';
import { isCentralAdminPerson } from '../lib/centralAdmin';
import { leadershipMutationLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import { recordAudit } from '../lib/audit';
import { prisma } from '../lib/prisma';
import { searchGroups, searchMembers } from '../lib/teachingRota';
import { TeacherError, addGroupTeacher, addTeachingDay, listGroupTeachers, removeGroupTeacher, removeTeachingDay } from '../lib/groupTeachers';

// Teachers who teach with the central admin in the groups the central admin allows, and their teaching days. Central admin only,
// from their own member profile.

const onError = (err: unknown, _req: Request, res: any, next: any) => {
  if (err instanceof TeacherError) return res.status(err.status).json({ error: err.message, code: err.code });
  next(err);
};
const daySchema = z.object({ dayOfWeek: z.number().int().min(1).max(7).optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) });

export const memberCentralGroupTeachersRoutes = (() => {
  const router = Router();
  router.use(requireMember);
  router.use(
    asyncHandler(async (req, res, next) => {
      if (!(await isCentralAdminPerson(req.member!.personId))) return res.status(403).json({ error: 'Forbidden.' });
      next();
    }),
  );
  const audit = async (req: Request, action: string, targetId: string, metadata?: Record<string, unknown>) => {
    const user = await prisma.user.findUnique({ where: { personId: req.member!.personId }, select: { id: true, email: true } });
    if (user) await recordAudit({ actorId: user.id, actorEmail: user.email, action, targetType: 'GroupTeacher', targetId, metadata });
  };

  router.get('/', asyncHandler(async (_req, res) => {
    res.json({ teachers: await listGroupTeachers() });
  }));
  router.get('/members', asyncHandler(async (req, res) => {
    res.json(await searchMembers(String(req.query.search ?? '')));
  }));
  router.get('/groups', asyncHandler(async (req, res) => {
    res.json({ items: await searchGroups(String(req.query.search ?? '')) });
  }));
  router.post('/', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const p = z.object({ personId: z.string().min(1), communityId: z.string().min(1) }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: 'Choose a member and a group.' });
    const made = await addGroupTeacher(p.data.personId, p.data.communityId);
    await audit(req, 'GROUP_TEACHER_ADDED', made.id, { communityId: p.data.communityId });
    res.status(201).json({ teachers: await listGroupTeachers() });
  }));
  router.delete('/days/:dayId', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    await removeTeachingDay(req.params.dayId);
    res.json({ teachers: await listGroupTeachers() });
  }));
  router.delete('/:id', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    await removeGroupTeacher(req.params.id);
    await audit(req, 'GROUP_TEACHER_REMOVED', req.params.id);
    res.json({ teachers: await listGroupTeachers() });
  }));
  router.post('/:id/days', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const p = daySchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: 'Check the day and the time.' });
    await addTeachingDay(req.params.id, p.data);
    res.status(201).json({ teachers: await listGroupTeachers() });
  }));
  router.use(onError);
  return router;
})();
