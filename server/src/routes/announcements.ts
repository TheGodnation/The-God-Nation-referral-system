import { Router, type Request, type Response, type NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../lib/asyncHandler';
import { requireCsrf } from '../lib/csrf';
import { announcementReadLimiter } from '../lib/rateLimit';
import { resolveActingPersonId } from '../lib/leadership';
import { parsePagination, paginatedResult } from '../lib/pagination';
import {
  computeVisibleAnnouncementsForPerson,
  personCanViewAnnouncement,
  isAnnouncementRead,
  markAnnouncementRead,
  getReadAnnouncementIds,
} from '../lib/announcements';

declare global {
  namespace Express {
    interface Request {
      // Phase 3M.3: the acting Member's or Leader's own linked Person id,
      // set only by requireAnnouncementRecipient below — never derived from
      // client input. Admin never gets one: there is no Admin recipient
      // route here (Admin manages announcements via adminAnnouncements.ts,
      // it does not "receive" them through this shared surface). A distinct
      // property from Phase 3M.1/3M.2's actor-id properties — this route
      // family stays fully independent of those conversation routes.
      announcementRecipientPersonId?: string;
    }
  }
}

/**
 * Resolves the caller's own Person identity — either an authenticated
 * Member (req.member, set by loadMemberSession) or an authenticated Leader
 * (req.user with role LEADER, resolved via the existing User.personId
 * link). An Admin's req.user is deliberately never resolved here, mirroring
 * the same exclusion already established in
 * followUpConversations.ts/communityConversations.ts — Admin is never
 * granted recipient access as a side effect of managing announcements.
 */
async function resolveAnnouncementRecipientPersonId(req: Request): Promise<string | null> {
  if (req.member) return req.member.personId;
  if (req.user?.role === 'LEADER') return resolveActingPersonId(req.user.id);
  return null;
}

async function requireAnnouncementRecipient(req: Request, res: Response, next: NextFunction) {
  const personId = await resolveAnnouncementRecipientPersonId(req);
  if (!personId) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  req.announcementRecipientPersonId = personId;
  next();
}

const router = Router();

router.use(requireAnnouncementRecipient);

// Recipient-facing shape only: content, publishedAt, and (Phase 3M.5) the
// caller's own isRead flag — never target definitions, Community/Geography
// ids, creator, or any other internal organizational detail.
function toRecipientResponse(
  a: {
    id: string;
    titleEn: string;
    titleFr: string | null;
    bodyEn: string;
    bodyFr: string | null;
    publishedAt: Date | null;
  },
  isRead: boolean,
) {
  return {
    id: a.id,
    titleEn: a.titleEn,
    titleFr: a.titleFr,
    bodyEn: a.bodyEn,
    bodyFr: a.bodyFr,
    publishedAt: a.publishedAt,
    isRead,
  };
}

// GET /api/me/announcements — every published, non-archived announcement
// the caller currently qualifies for, newest-published-first, page-based
// pagination. The full eligible set is derived fresh on every request (see
// computeVisibleAnnouncementsForPerson) and paginated in memory — there is
// no persisted recipient list to query directly. Phase 3M.5: one batch
// query over the full eligible id set (not one per page item, not one per
// announcement) supplies both each item's isRead flag and unreadCount —
// unreadCount always reflects the full currently-eligible set, never just
// the current page.
router.get('/', asyncHandler(async (req, res) => {
  const personId = req.announcementRecipientPersonId!;
  const { page, pageSize, skip, take } = parsePagination(req);

  const eligible = await computeVisibleAnnouncementsForPerson(personId);
  const readIds = await getReadAnnouncementIds(personId, eligible.map((a) => a.id));
  const unreadCount = eligible.length - readIds.size;

  const pageItems = eligible.slice(skip, skip + take).map((a) => toRecipientResponse(a, readIds.has(a.id)));

  res.json({ ...paginatedResult(pageItems, eligible.length, page, pageSize), unreadCount });
}));

// GET /api/me/announcements/:id — 404 (never 403) for a nonexistent id, an
// unpublished/archived announcement, or one the caller doesn't qualify for
// — a guessed id can never be distinguished from a real one that isn't the
// caller's, matching the non-disclosure convention already used across
// Follow-Up routes. Remains a pure read: it never creates or updates an
// AnnouncementRead row (see POST .../read below for the one place that
// happens) — it only reports whether one already exists.
router.get('/:id', asyncHandler(async (req, res) => {
  const personId = req.announcementRecipientPersonId!;
  const { id } = req.params;

  const canView = await personCanViewAnnouncement(personId, id);
  if (!canView) {
    return res.status(404).json({ error: 'Announcement not found.' });
  }

  const announcement = await prisma.announcement.findUnique({ where: { id } });
  if (!announcement) {
    return res.status(404).json({ error: 'Announcement not found.' });
  }

  const isRead = await isAnnouncementRead(personId, id);
  res.json(toRecipientResponse(announcement, isRead));
}));

// POST /api/me/announcements/:id/read — marks the announcement read for the
// caller's own Person only (personId is always server-resolved via
// requireAnnouncementRecipient, never accepted from the client). Idempotent
// (markAnnouncementRead upserts on the (personId, announcementId) unique
// constraint), CSRF-protected, and rate-limited like every other
// authenticated mutation in this codebase. Same 404 non-disclosure as the
// detail route for a draft/archived/unknown/ineligible announcement — never
// reveals whether an inaccessible id exists. Never touches the Announcement
// row itself, its targets, or any membership/geography data.
router.post(
  '/:id/read',
  announcementReadLimiter,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const personId = req.announcementRecipientPersonId!;
    const { id } = req.params;

    const canView = await personCanViewAnnouncement(personId, id);
    if (!canView) {
      return res.status(404).json({ error: 'Announcement not found.' });
    }

    await markAnnouncementRead(personId, id);
    res.json({ id, isRead: true });
  }),
);

export default router;
