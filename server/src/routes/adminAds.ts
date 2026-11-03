import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { requireMember } from '../lib/memberAuth';
import { requireCsrf } from '../lib/csrf';
import { isCentralAdminPerson } from '../lib/centralAdmin';
import { leadershipMutationLimiter, generalApiLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import { recordAudit } from '../lib/audit';
import { platformsReady } from '../lib/adsEvents';
import { audienceCsv, audienceRows, type AudienceKind } from '../lib/adsAudience';

// The central admin's "Ads connections" card: which ad platforms are connected, what
// server-side events were sent lately, and the hashed member lists for ad platforms.
// Public identifiers are edited here; the secret access tokens are only ever set as
// server environment variables (never stored in the database, never sent to a browser).
// Offered in the admin dashboard and in the central admin's own member profile.
type Actor = { id: string; email: string };

const DAY = 24 * 60 * 60 * 1000;

const emptyToNull = (v: string | null | undefined) => (v === undefined ? undefined : v === null || v.trim() === '' ? null : v.trim());
const idField = (re: RegExp) => z.string().trim().regex(re).nullable().or(z.literal('')).optional();

const putSchema = z.object({
  metaPixelId: idField(/^\d{8,20}$/),
  tiktokPixelId: idField(/^[A-Za-z0-9]{8,32}$/),
  googleTagId: idField(/^(AW-\d{6,14}|G-[A-Za-z0-9]{6,14}|GT-[A-Za-z0-9]{6,14})$/),
  googleLeadSendTo: idField(/^AW-\d{6,14}\/[A-Za-z0-9_-]{6,40}$/),
  googleSignupSendTo: idField(/^AW-\d{6,14}\/[A-Za-z0-9_-]{6,40}$/),
});

async function summary() {
  const s = await prisma.settings.findUnique({
    where: { id: 'singleton' },
    select: { metaPixelId: true, tiktokPixelId: true, googleTagId: true, googleLeadSendTo: true, googleSignupSendTo: true, reminderQuietDays: true },
  });
  const ready = platformsReady({ metaPixelId: s?.metaPixelId ?? null, tiktokPixelId: s?.tiktokPixelId ?? null });
  const since = new Date(Date.now() - 7 * DAY);
  const [recent, okCount, failCount, members, quiet] = await Promise.all([
    prisma.adEventLog.findMany({ orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, platform: true, event: true, ok: true, status: true, error: true, createdAt: true } }),
    prisma.adEventLog.count({ where: { createdAt: { gte: since }, ok: true } }),
    prisma.adEventLog.count({ where: { createdAt: { gte: since }, ok: false } }),
    audienceRows('members', s?.reminderQuietDays ?? 7),
    audienceRows('quiet', s?.reminderQuietDays ?? 7),
  ]);
  return {
    ids: {
      metaPixelId: s?.metaPixelId ?? null,
      tiktokPixelId: s?.tiktokPixelId ?? null,
      googleTagId: s?.googleTagId ?? null,
      googleLeadSendTo: s?.googleLeadSendTo ?? null,
      googleSignupSendTo: s?.googleSignupSendTo ?? null,
    },
    // Whether the secret tokens are set on the server. The tokens themselves are never shown.
    meta: { tokenSet: Boolean(process.env.META_CAPI_TOKEN), testMode: Boolean(process.env.META_TEST_EVENT_CODE), serverReady: ready.meta },
    tiktok: { tokenSet: Boolean(process.env.TIKTOK_EVENTS_TOKEN), testMode: Boolean(process.env.TIKTOK_TEST_EVENT_CODE), serverReady: ready.tiktok },
    last7: { ok: okCount, failed: failCount },
    recent,
    audiences: { members: members.length, quiet: quiet.length, quietDays: s?.reminderQuietDays ?? 7 },
  };
}

function build(resolveActor: (req: Request) => Promise<Actor | null>) {
  const router = Router();
  router.get('/', asyncHandler(async (_req, res) => res.json(await summary())));

  router.put('/', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const parsed = putSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'One of the ids does not look right. Copy it again exactly as the ad platform shows it.', field: parsed.error.issues[0]?.path[0] ?? null });
    }
    const actor = await resolveActor(req);
    if (!actor) return res.status(403).json({ error: 'Forbidden.' });
    const d = parsed.data;
    const data = {
      ...(d.metaPixelId !== undefined ? { metaPixelId: emptyToNull(d.metaPixelId) } : {}),
      ...(d.tiktokPixelId !== undefined ? { tiktokPixelId: emptyToNull(d.tiktokPixelId) } : {}),
      ...(d.googleTagId !== undefined ? { googleTagId: emptyToNull(d.googleTagId) } : {}),
      ...(d.googleLeadSendTo !== undefined ? { googleLeadSendTo: emptyToNull(d.googleLeadSendTo) } : {}),
      ...(d.googleSignupSendTo !== undefined ? { googleSignupSendTo: emptyToNull(d.googleSignupSendTo) } : {}),
    };
    await prisma.settings.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', ...data }, update: data });
    await recordAudit({ actorId: actor.id, actorEmail: actor.email, action: 'ADS_IDS_UPDATED', targetType: 'Settings', targetId: 'singleton', metadata: { changed: Object.keys(data) } });
    res.json(await summary());
  }));

  // The hashed list as a spreadsheet file. Counts as an export: it is written to the audit trail.
  router.get('/audience.csv', generalApiLimiter, asyncHandler(async (req, res) => {
    const kind: AudienceKind = req.query.kind === 'quiet' ? 'quiet' : 'members';
    const actor = await resolveActor(req);
    if (!actor) return res.status(403).json({ error: 'Forbidden.' });
    const s = await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { reminderQuietDays: true } });
    const rows = await audienceRows(kind, s?.reminderQuietDays ?? 7);
    await recordAudit({ actorId: actor.id, actorEmail: actor.email, action: 'ADS_AUDIENCE_EXPORTED', targetType: 'Settings', targetId: 'singleton', metadata: { kind, people: rows.length } });
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="god-nation-${kind}-hashed.csv"`);
    res.set('Cache-Control', 'no-store');
    res.send(audienceCsv(rows));
  }));
  return router;
}

export const adminAdsRoutes = (() => {
  const router = Router();
  router.use(requireAuth, requireRole('ADMIN'));
  router.use(build(async (req) => (req.user ? { id: req.user.id, email: req.user.email } : null)));
  return router;
})();

export const memberCentralAdsRoutes = (() => {
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
      return user && user.role === 'ADMIN' && user.active ? { id: user.id, email: user.email } : null;
    }),
  );
  return router;
})();
