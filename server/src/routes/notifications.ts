import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../lib/asyncHandler';
import { requireCsrf } from '../lib/csrf';
import { notificationReadLimiter } from '../lib/rateLimit';
import { parsePagination, paginatedResult } from '../lib/pagination';
import { resolvePrivateMessagingActor, type PrivateMessagingActor } from '../lib/privateMessaging';
import { isPushConfigured, vapidPublicKey } from '../lib/push';

// In-App Notifications Foundation — a shared authenticated surface for
// whichever identity the caller resolves to (a Member or Leader, both
// Persons; or an Admin, a User — the one Notification recipient type that
// isn't a Person, matching the exact reason lib/privateMessaging.ts's own
// Admin-as-participant case exists). Reuses that file's own identity
// resolver directly rather than re-deriving "which session is this" a
// second time — the only thing genuinely specific to this feature is the
// request property name below, since Notifications is an unrelated concern
// from Private Messaging and shouldn't share its own request property.
declare global {
  namespace Express {
    interface Request {
      notificationActor?: PrivateMessagingActor;
    }
  }
}

async function requireNotificationActor(req: Request, res: Response, next: NextFunction) {
  const actor = await resolvePrivateMessagingActor(req);
  if (!actor) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  req.notificationActor = actor;
  next();
}

const router = Router();

router.use(requireNotificationActor);

function actorWhere(actor: PrivateMessagingActor) {
  return actor.type === 'PERSON' ? { recipientPersonId: actor.personId } : { recipientUserId: actor.userId };
}

// GET /api/notifications — the caller's own notifications only, newest
// first. Never accepts a client-supplied recipient filter — the WHERE
// clause is always keyed off the server-resolved actor identity.
router.get('/', asyncHandler(async (req, res) => {
  const actor = req.notificationActor!;
  const { page, pageSize, skip, take } = parsePagination(req);
  const where = actorWhere(actor);

  const [total, items] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
  ]);

  res.json(
    paginatedResult(
      items.map((n) => ({
        id: n.id,
        type: n.type,
        metadata: n.metadata,
        targetType: n.targetType,
        targetId: n.targetId,
        readAt: n.readAt,
        createdAt: n.createdAt,
      })),
      total,
      page,
      pageSize,
    ),
  );
}));

// GET /api/notifications/unread-count — a single number, polled by the
// notification bell independently of opening the full list.
router.get('/unread-count', asyncHandler(async (req, res) => {
  const actor = req.notificationActor!;
  const count = await prisma.notification.count({ where: { ...actorWhere(actor), readAt: null } });
  res.json({ unreadCount: count });
}));

// PATCH /api/notifications/:id/read — marks exactly one of the caller's own
// notifications read. Idempotent: marking an already-read notification read
// again is a harmless no-op, never an error. Uses 404 (not 403) for a
// non-owned notification, so the response never confirms whether the id
// belongs to someone else at all — same convention as
// privateMessages.ts's loadAuthorizedConversation.
router.patch('/:id/read', notificationReadLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const actor = req.notificationActor!;
  const { id } = req.params;

  const notification = await prisma.notification.findUnique({ where: { id } });
  const owns =
    notification &&
    (actor.type === 'PERSON' ? notification.recipientPersonId === actor.personId : notification.recipientUserId === actor.userId);
  if (!owns) {
    return res.status(404).json({ error: 'Notification not found.' });
  }

  const updated = notification!.readAt
    ? notification!
    : await prisma.notification.update({ where: { id }, data: { readAt: new Date() } });

  res.json({ id: updated.id, readAt: updated.readAt });
}));

// ── Web Push subscriptions (background/closed-app delivery) ────────────
// See lib/push.ts for why this exists: the Notification rows above are an
// in-app inbox only — nothing reaches a closed app/tab without a real
// browser Push subscription behind it.

// GET /api/notifications/push/vapid-public-key — the public key the client
// passes to PushManager.subscribe(). `configured: false` means the server
// has no VAPID keys set (Render env vars) — the client should not attempt
// to subscribe (it would "succeed" locally but nothing would ever be
// delivered), and should say so rather than claiming notifications work.
router.get('/push/vapid-public-key', asyncHandler(async (_req, res) => {
  res.json({ configured: isPushConfigured(), publicKey: vapidPublicKey() });
}));

const subscribeSchema = z.object({
  endpoint: z.string().trim().min(1).max(2000),
  keys: z.object({
    p256dh: z.string().trim().min(1).max(500),
    auth: z.string().trim().min(1).max(500),
  }),
  userAgent: z.string().trim().max(500).optional(),
});

// POST /api/notifications/push/subscribe — registers (or re-registers) one
// browser/device subscription for the caller. Keyed by `endpoint` (already
// globally unique per registration), so calling this again for the same
// device — e.g. the service worker refreshing its own subscription — just
// updates who owns it rather than creating a duplicate row.
router.post('/push/subscribe', notificationReadLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const actor = req.notificationActor!;
  const parsed = subscribeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid subscription.' });
  const { endpoint, keys, userAgent } = parsed.data;

  const identity =
    actor.type === 'PERSON'
      ? { personId: actor.personId, userId: null }
      : { personId: null, userId: actor.userId };

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: userAgent ?? null, ...identity },
    update: { p256dh: keys.p256dh, auth: keys.auth, userAgent: userAgent ?? null, ...identity },
  });
  res.status(201).json({ ok: true });
}));

// DELETE /api/notifications/push/subscribe — called when the client turns
// notifications off, or the browser/OS has revoked permission. Ownership
// isn't checked beyond the endpoint matching — an endpoint is an opaque,
// unguessable per-device URL, the same trust boundary the browser itself
// relies on, so this never needs to resolve "whose" it is first.
router.delete('/push/subscribe', notificationReadLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = z.object({ endpoint: z.string().trim().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request.' });
  await prisma.pushSubscription.deleteMany({ where: { endpoint: parsed.data.endpoint } });
  res.json({ ok: true });
}));

export default router;
