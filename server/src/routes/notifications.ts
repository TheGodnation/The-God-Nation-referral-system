import { Router, type Request, type Response, type NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../lib/asyncHandler';
import { requireCsrf } from '../lib/csrf';
import { notificationReadLimiter } from '../lib/rateLimit';
import { parsePagination, paginatedResult } from '../lib/pagination';
import { resolvePrivateMessagingActor, type PrivateMessagingActor } from '../lib/privateMessaging';

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

export default router;
