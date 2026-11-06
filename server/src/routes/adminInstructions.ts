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
  MAX_BODY_CHARS,
  MAX_NOTE_CHARS,
  MAX_TITLE_CHARS,
  createInstruction,
  generationsOf,
  instructionTracker,
  instructionsFor,
  listInstructions,
  listLeaders,
  markDone,
  markSeen,
  remindUnfinished,
} from '../lib/leaderInstructions';

// The National Coordinator's instructions to leaders. Offered twice, with the same rules — in the admin
// dashboard and in the central admin's own member profile. A leader sees only what was sent to them
// (the /api/member/instructions routes at the bottom); only the central admin can write or follow up.
type Actor = { userId: string | null; personId: string | null; email: string | null };

const createSchema = z
  .object({
    title: z.string().trim().min(1).max(MAX_TITLE_CHARS),
    body: z.string().trim().min(1).max(MAX_BODY_CHARS),
    audience: z.enum(['ALL_LEADERS', 'GENERATIONS', 'PICKED']),
    generations: z.array(z.number().int().min(0).max(50)).max(51).optional().default([]),
    personIds: z.array(z.string().min(1)).max(2000).optional().default([]),
    dueAt: z.string().datetime().optional().nullable(),
    repliesVisible: z.boolean().optional().default(false),
  })
  .refine((v) => v.audience !== 'GENERATIONS' || v.generations.length > 0, { message: 'Choose at least one generation.' })
  .refine((v) => v.audience !== 'PICKED' || v.personIds.length > 0, { message: 'Choose at least one leader.' });

function buildInstructionsRouter(resolveActor: (req: Request) => Promise<Actor | null>) {
  const router = Router();

  router.get('/leaders', asyncHandler(async (_req, res) => {
    const leaders = await listLeaders();
    res.json({ leaders, generations: generationsOf(leaders) });
  }));

  router.get('/', asyncHandler(async (_req, res) => {
    res.json({ items: await listInstructions() });
  }));

  router.post('/', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Check the title, the text and who it is for.' });
    const actor = await resolveActor(req);
    if (!actor) return res.status(403).json({ error: 'Forbidden.' });
    const d = parsed.data;
    const result = await createInstruction({
      title: d.title,
      body: d.body,
      audience: d.audience,
      generations: d.generations,
      personIds: d.personIds,
      dueAt: d.dueAt ? new Date(d.dueAt) : null,
      repliesVisible: d.repliesVisible,
      createdByUserId: actor.userId,
      createdByPersonId: actor.personId,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    await recordAudit({
      actorId: actor.userId ?? undefined,
      actorEmail: actor.email ?? undefined,
      action: 'LEADER_INSTRUCTION_SENT',
      targetType: 'LeaderInstruction',
      targetId: result.id,
      metadata: { audience: d.audience, recipients: result.recipients },
    });
    res.status(201).json({ id: result.id, recipients: result.recipients });
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    const tracker = await instructionTracker(String(req.params.id));
    if (!tracker) return res.status(404).json({ error: 'Instruction not found.' });
    res.json(tracker);
  }));

  router.post('/:id/remind', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const result = await remindUnfinished(String(req.params.id));
    if (!result) return res.status(404).json({ error: 'Instruction not found.' });
    res.json(result);
  }));

  return router;
}

export const adminInstructionsRoutes = (() => {
  const router = Router();
  router.use(requireAuth, requireRole('ADMIN'));
  router.use(buildInstructionsRouter(async (req) => (req.user ? { userId: req.user.id, personId: req.user.personId ?? null, email: req.user.email } : null)));
  return router;
})();

export const memberCentralInstructionsRoutes = (() => {
  const router = Router();
  router.use(requireMember);
  router.use(
    asyncHandler(async (req, res, next) => {
      if (!(await isCentralAdminPerson(req.member!.personId))) return res.status(403).json({ error: 'Forbidden.' });
      next();
    }),
  );
  router.use(
    buildInstructionsRouter(async (req) => {
      const user = await prisma.user.findUnique({ where: { personId: req.member!.personId }, select: { id: true, email: true, role: true, active: true } });
      return user && user.role === 'ADMIN' && user.active ? { userId: user.id, personId: req.member!.personId, email: user.email } : null;
    }),
  );
  return router;
})();

// A leader's own view: the instructions sent to them, and marking them Seen or Done.
export const memberInstructionsRoutes = (() => {
  const router = Router();
  router.use(requireMember);

  router.get('/', asyncHandler(async (req, res) => {
    res.json({ items: await instructionsFor(req.member!.personId) });
  }));

  router.post('/:id/seen', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const ok = await markSeen(String(req.params.id), req.member!.personId);
    if (!ok) return res.status(404).json({ error: 'Instruction not found.' });
    res.json({ ok: true });
  }));

  router.post('/:id/done', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const parsed = z.object({ note: z.string().trim().max(MAX_NOTE_CHARS).optional().nullable() }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: 'The note is too long.' });
    const ok = await markDone(String(req.params.id), req.member!.personId, parsed.data.note || null);
    if (!ok) return res.status(404).json({ error: 'Instruction not found.' });
    res.json({ ok: true });
  }));

  return router;
})();
