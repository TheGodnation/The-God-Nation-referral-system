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
import { LEVELS, RotaError, addTeacher, adminOverview, guidePreview, loadPlan, matchTeachers, rate, ratingDetail, searchGroups, searchMembers, teacherView, toRate, topicPreview, updateSettings, updateTeacher } from '../lib/teachingRota';
import { sendAssignmentsNow } from '../lib/teachingReminders';
import { isFrench } from '../lib/privateNotice';

// The weekly teaching rota. Two doors for the central admin (the admin dashboard and the National Coordinator's member
// profile, one set of rules), and one for a teacher, who only ever gets their own assignment.

type Actor = { id: string; email: string };
const onError = (err: unknown, _req: Request, res: any, next: any) => {
  if (err instanceof RotaError) return res.status(err.status).json({ error: err.message, code: err.code });
  next(err);
};

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const settingsSchema = z.object({ enabled: z.boolean().optional(), frenchChecked: z.boolean().optional(), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), ratersCommunityId: z.string().min(1).nullable().optional() });
const newTeacherSchema = z.object({ name: z.string().trim().min(1).max(200), personId: z.string().min(1).nullable().optional(), dayOfWeek: z.number().int().min(1).max(7), startTime: timeSchema });
const patchTeacherSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  personId: z.string().min(1).nullable().optional(),
  dayOfWeek: z.number().int().min(1).max(7).optional(),
  startTime: timeSchema.optional(),
  active: z.boolean().optional(),
});

function buildAdminRouter(resolveActor: (req: Request) => Promise<Actor | null>) {
  const router = Router();
  const actorOr403 = async (req: Request, res: any) => {
    const a = await resolveActor(req);
    if (!a) res.status(403).json({ error: 'Forbidden.' });
    return a;
  };

  router.get('/overview', asyncHandler(async (_req, res) => {
    res.json(await adminOverview());
  }));

  router.get('/topics/:number', asyncHandler(async (req, res) => {
    const n = Number(req.params.number);
    if (!Number.isInteger(n)) return res.status(400).json({ error: 'Bad topic number.' });
    res.json(await topicPreview(n));
  }));

  router.get('/guide', asyncHandler(async (_req, res) => {
    res.json({ guide: await guidePreview() });
  }));

  router.get('/members', asyncHandler(async (req, res) => {
    res.json({ items: await searchMembers(String(req.query.search ?? '')) });
  }));

  router.get('/groups', asyncHandler(async (req, res) => {
    res.json({ items: await searchGroups(String(req.query.search ?? '')) });
  }));

  router.get('/ratings/:teacherId', asyncHandler(async (req, res) => {
    res.json(await ratingDetail(String(req.params.teacherId)));
  }));

  router.post('/send-assignments', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const actor = await actorOr403(req, res);
    if (!actor) return;
    const result = await sendAssignmentsNow();
    await recordAudit({ actorId: actor.id, actorEmail: actor.email, action: 'TEACHING_ASSIGNMENTS_SENT', targetType: 'TeachingSettings', targetId: 'main', metadata: result });
    res.json(result);
  }));

  router.post('/plan', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const actor = await actorOr403(req, res);
    if (!actor) return;
    const summary = await loadPlan(req.body);
    await recordAudit({ actorId: actor.id, actorEmail: actor.email, action: 'TEACHING_PLAN_LOADED', targetType: 'TeachingSettings', targetId: 'main', metadata: summary });
    res.json({ summary, overview: await adminOverview() });
  }));

  router.post('/match', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const actor = await actorOr403(req, res);
    if (!actor) return;
    const result = await matchTeachers();
    await recordAudit({ actorId: actor.id, actorEmail: actor.email, action: 'TEACHING_NAMES_MATCHED', targetType: 'TeachingSettings', targetId: 'main', metadata: { matched: result.matched, ambiguous: result.ambiguous.length, notFound: result.notFound.length } });
    res.json({ result, overview: await adminOverview() });
  }));

  router.put('/settings', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Check the settings and try again.' });
    const actor = await actorOr403(req, res);
    if (!actor) return;
    const overview = await updateSettings(parsed.data);
    await recordAudit({ actorId: actor.id, actorEmail: actor.email, action: 'TEACHING_SETTINGS_UPDATED', targetType: 'TeachingSettings', targetId: 'main', metadata: parsed.data });
    res.json(overview);
  }));

  router.post('/teachers', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const parsed = newTeacherSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Enter a name, a day and a time.' });
    const actor = await actorOr403(req, res);
    if (!actor) return;
    const t = await addTeacher(parsed.data);
    await recordAudit({ actorId: actor.id, actorEmail: actor.email, action: 'TEACHING_TEACHER_ADDED', targetType: 'TeachingTeacher', targetId: t.id, metadata: { dayOfWeek: t.dayOfWeek, startMinute: t.startMinute } });
    res.status(201).json(await adminOverview());
  }));

  router.patch('/teachers/:id', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const parsed = patchTeacherSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Check the details and try again.' });
    const actor = await actorOr403(req, res);
    if (!actor) return;
    const t = await updateTeacher(String(req.params.id), parsed.data);
    await recordAudit({ actorId: actor.id, actorEmail: actor.email, action: 'TEACHING_TEACHER_UPDATED', targetType: 'TeachingTeacher', targetId: t.id, metadata: parsed.data });
    res.json(await adminOverview());
  }));

  router.use(onError);
  return router;
}

// Admin dashboard (admin sign-in).
export const adminTeachingRotaRoutes = (() => {
  const router = Router();
  router.use(requireAuth, requireRole('ADMIN'));
  router.use(buildAdminRouter(async (req) => (req.user ? { id: req.user.id, email: req.user.email } : null)));
  return router;
})();

// The National Coordinator's own member profile (member sign-in).
export const memberCentralTeachingRotaRoutes = (() => {
  const router = Router();
  router.use(requireMember);
  router.use(
    asyncHandler(async (req, res, next) => {
      if (!(await isCentralAdminPerson(req.member!.personId))) return res.status(403).json({ error: 'Forbidden.' });
      next();
    }),
  );
  router.use(
    buildAdminRouter(async (req) => {
      const user = await prisma.user.findUnique({ where: { personId: req.member!.personId }, select: { id: true, email: true, role: true, active: true } });
      return user && user.role === 'ADMIN' && user.active ? { id: user.id, email: user.email } : null;
    }),
  );
  return router;
})();

// A teacher: only their own assignment, never anyone else's.
export const memberTeachingRotaRoutes = (() => {
  const router = Router();
  router.use(requireMember);
  router.get('/me', asyncHandler(async (req, res) => {
    res.json(await teacherView(req.member!.personId));
  }));
  // The teachings this member can rate now (not their own), and rating one.
  router.get('/to-rate', asyncHandler(async (req, res) => {
    const person = await prisma.person.findUnique({ where: { id: req.member!.personId }, select: { preferredLanguage: true } });
    res.json({ items: await toRate(req.member!.personId, isFrench(person?.preferredLanguage) ? 'fr' : 'en') });
  }));
  router.post('/rate', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const parsed = z.object({ teacherId: z.string().min(1), weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), level: z.enum(LEVELS) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Choose how it was.' });
    res.json(await rate(req.member!.personId, parsed.data));
  }));
  router.use(onError);
  return router;
})();
