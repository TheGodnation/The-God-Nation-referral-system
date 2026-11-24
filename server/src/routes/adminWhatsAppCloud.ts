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
import { normalizeToE164 } from '../lib/phone';
import { cloudConfigured, cloudMode, sendTestMessage } from '../lib/whatsappCloud';

// The central admin's switch for the automatic WhatsApp messages (Meta's WhatsApp Business Platform): off / test / on, a button
// that sends Meta's sample message to one number, and what went out recently. Offered in the admin dashboard and in the central
// admin's own member profile. The access token is never shown, here or anywhere.
type Actor = { id: string; email: string; personId: string | null };

const maskNumber = (n: string) => (n.length > 6 ? `${n.slice(0, 4)}…${n.slice(-3)}` : n);

async function summary() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [mode, recent, today] = await Promise.all([
    cloudMode(),
    prisma.whatsAppCloudSend.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
    prisma.whatsAppCloudSend.groupBy({ by: ['status'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
  ]);
  const count = (s: string) => today.find((x) => x.status === s)?._count._all ?? 0;
  return {
    mode,
    configured: cloudConfigured(),
    today: { sent: count('SENT'), failed: count('FAILED'), skipped: count('SKIPPED') },
    recent: recent.map((r) => ({ id: r.id, at: r.createdAt, to: maskNumber(r.toNumber), kind: r.kind, status: r.status, reason: r.reason })),
  };
}

function build(resolveActor: (req: Request) => Promise<Actor | null>) {
  const router = Router();
  router.get('/', asyncHandler(async (_req, res) => res.json(await summary())));

  const putSchema = z.object({ mode: z.enum(['OFF', 'TEST', 'ON']) });
  router.put('/', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const parsed = putSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Choose Off, Test or On.', code: 'INVALID' });
    const actor = await resolveActor(req);
    if (!actor) return res.status(403).json({ error: 'Forbidden.' });
    const { mode } = parsed.data;
    if (mode !== 'OFF' && !cloudConfigured()) {
      return res.status(400).json({ error: 'WhatsApp sending is not set up yet: the access token and the number id have to be added on the server first.', code: 'NOT_CONFIGURED' });
    }
    await prisma.settings.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', whatsappCloudMode: mode }, update: { whatsappCloudMode: mode } });
    await recordAudit({ actorId: actor.id, actorEmail: actor.email, action: 'WHATSAPP_CLOUD_MODE_UPDATED', targetType: 'Settings', targetId: 'singleton', metadata: { mode } });
    res.json(await summary());
  }));

  // Meta's sample message to one number (their own, unless another is typed). It needs the sending set up, and with Meta's test
  // number the receiving number has to be on the test list.
  const testSchema = z.object({ to: z.string().trim().min(5).max(32).optional() });
  router.post('/test', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const parsed = testSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: 'Enter a valid phone number, with the country code.', code: 'INVALID' });
    const actor = await resolveActor(req);
    if (!actor) return res.status(403).json({ error: 'Forbidden.' });
    if (!cloudConfigured()) return res.status(400).json({ error: 'WhatsApp sending is not set up yet.', code: 'NOT_CONFIGURED' });
    let to: string | null = null;
    if (parsed.data.to) to = normalizeToE164(parsed.data.to);
    else if (actor.personId) to = (await prisma.person.findUnique({ where: { id: actor.personId }, select: { whatsappNumber: true } }))?.whatsappNumber ?? null;
    if (!to) return res.status(400).json({ error: 'Enter a valid phone number, with the country code.', code: 'INVALID' });
    const result = await sendTestMessage(to, actor.personId);
    await recordAudit({ actorId: actor.id, actorEmail: actor.email, action: 'WHATSAPP_CLOUD_TEST_SENT', targetType: 'Settings', targetId: 'singleton', metadata: { ok: result.ok } });
    if (!result.ok) return res.status(502).json({ error: result.error, code: 'SEND_FAILED', ...(await summary()) });
    res.json(await summary());
  }));
  return router;
}

export const adminWhatsAppCloudRoutes = (() => {
  const router = Router();
  router.use(requireAuth, requireRole('ADMIN'));
  router.use(build(async (req) => (req.user ? { id: req.user.id, email: req.user.email, personId: (await prisma.user.findUnique({ where: { id: req.user.id }, select: { personId: true } }))?.personId ?? null } : null)));
  return router;
})();

export const memberCentralWhatsAppCloudRoutes = (() => {
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
      const user = await prisma.user.findUnique({ where: { personId: req.member!.personId }, select: { id: true, email: true, role: true, active: true, personId: true } });
      return user && user.role === 'ADMIN' && user.active ? { id: user.id, email: user.email, personId: user.personId } : null;
    }),
  );
  return router;
})();
