import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { requireMember } from '../lib/memberAuth';
import { requireCsrf } from '../lib/csrf';
import { isCentralAdminPerson } from '../lib/centralAdmin';
import { communityMutationLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import { recordAudit } from '../lib/audit';
import { BulkError, MAX_BULK, bulkAdd, generationSummary, listPeople, listPeopleIds, parseSource, searchAssemblies } from '../lib/bulkMembers';

// "Add many people": offered twice with the same rules — in the admin dashboard and in the central
// admin's own member profile.
type Actor = { userId: string | null; email: string | null };

const addSchema = z
  .object({
    personIds: z.array(z.string().min(1)).min(1, 'Select at least one person.').max(MAX_BULK),
    destinationId: z.string().min(1).optional(),
    newAssembly: z.object({ name: z.string().trim().min(1, 'Give the new assembly a name.').max(200), parentId: z.string().min(1).nullable().optional() }).optional(),
    removeFromSource: z.string().min(1).optional(),
  })
  .refine((d) => Boolean(d.destinationId) !== Boolean(d.newAssembly), { message: 'Choose one place to add them: an existing assembly or a new one.' });

function build(resolveActor: (req: Request) => Promise<Actor | null>) {
  const router = Router();

  router.get('/generations', asyncHandler(async (_req, res) => {
    res.json(await generationSummary());
  }));

  router.get('/assemblies', asyncHandler(async (req, res) => {
    res.json({ items: await searchAssemblies(String(req.query.search ?? '')) });
  }));

  router.get('/people', asyncHandler(async (req, res) => {
    const source = parseSource(req.query.source);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 50));
    const page = Math.max(1, Number(req.query.page) || 1);
    const { total, items } = await listPeople(source, typeof req.query.search === 'string' ? req.query.search : undefined, (page - 1) * pageSize, pageSize);
    res.json({ items, total, page, pageSize });
  }));

  router.get('/ids', asyncHandler(async (req, res) => {
    const source = parseSource(req.query.source);
    res.json(await listPeopleIds(source, typeof req.query.search === 'string' ? req.query.search : undefined));
  }));

  router.post('/add', communityMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const parsed = addSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request.' });
    const actor = await resolveActor(req);
    const result = await bulkAdd(parsed.data);
    await recordAudit({
      actorId: actor?.userId ?? null,
      actorEmail: actor?.email ?? null,
      action: 'COMMUNITY_MEMBERS_BULK_ADDED',
      targetType: 'Community',
      targetId: result.destination.id,
      metadata: { name: result.destination.name, created: result.created, added: result.added, alreadyIn: result.alreadyIn, removedFromSource: result.removed },
    });
    res.status(201).json(result);
  }));

  router.use((err: unknown, _req: Request, res: any, next: any) => {
    if (err instanceof BulkError) return res.status(err.status).json({ error: err.message });
    next(err);
  });
  return router;
}

export const adminBulkMembersRoutes = (() => {
  const router = Router();
  router.use(requireAuth, requireRole('ADMIN'));
  router.use(build(async (req) => (req.user ? { userId: req.user.id, email: req.user.email } : null)));
  return router;
})();

export const memberCentralBulkMembersRoutes = (() => {
  const router = Router();
  router.use(requireMember);
  router.use(
    asyncHandler(async (req, res, next) => {
      if (!(await isCentralAdminPerson(req.member!.personId))) return res.status(403).json({ error: 'Forbidden.' });
      next();
    }),
  );
  router.use(
    build(async (req) => {
      const user = await prisma.user.findUnique({ where: { personId: req.member!.personId }, select: { id: true, email: true, role: true, active: true } });
      return user && user.role === 'ADMIN' && user.active ? { userId: user.id, email: user.email } : null;
    }),
  );
  return router;
})();
