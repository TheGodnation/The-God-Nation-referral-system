import { Router, type Request, type Response, type NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../lib/asyncHandler';
import { resolveActingPersonId } from '../lib/leadership';
import { parsePagination, paginatedResult } from '../lib/pagination';
import { hasResourceAccess } from '../lib/resourceAccess';

declare global {
  namespace Express {
    interface Request {
      // Book / Resource Access Grants — the acting Member's or Leader's own
      // linked Person id, set only by requireResourceRecipient below —
      // never derived from client input. Admin never gets one: Admin
      // manages the catalog and grants via adminResources.ts/
      // adminResourceAccess.ts, it does not "receive" resources through
      // this shared surface — same exclusion already established by
      // announcements.ts/headquartersPosts.ts.
      resourceRecipientPersonId?: string;
    }
  }
}

async function resolveResourceRecipientPersonId(req: Request): Promise<string | null> {
  if (req.member) return req.member.personId;
  if (req.user?.role === 'LEADER') return resolveActingPersonId(req.user.id);
  return null;
}

async function requireResourceRecipient(req: Request, res: Response, next: NextFunction) {
  const personId = await resolveResourceRecipientPersonId(req);
  if (!personId) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  req.resourceRecipientPersonId = personId;
  next();
}

const router = Router();

router.use(requireResourceRecipient);

// Recipient-facing shape only: content the UI needs, never grant/audit
// internals (grantedByUserId, revokedAt, etc.) and never any unrelated
// Person field.
function toRecipientResponse(r: { id: string; titleEn: string; titleFr: string | null; descriptionEn: string | null; descriptionFr: string | null; url: string | null }) {
  return {
    id: r.id,
    titleEn: r.titleEn,
    titleFr: r.titleFr,
    descriptionEn: r.descriptionEn,
    descriptionFr: r.descriptionFr,
    url: r.url,
  };
}

// GET /api/me/resources — every Resource the caller currently has an
// ACTIVE grant for AND that is still `active` (a revoked grant, or a
// Resource the Admin has since deactivated, is never listed here — the
// grant row itself is never deleted, only its status changes). Page-based
// pagination, reusing lib/pagination.ts.
router.get('/', asyncHandler(async (req, res) => {
  const personId = req.resourceRecipientPersonId!;
  const { page, pageSize, skip, take } = parsePagination(req);

  const where = { personId, status: 'ACTIVE' as const, resource: { active: true } };

  const [total, grants] = await Promise.all([
    prisma.resourceAccessGrant.count({ where }),
    prisma.resourceAccessGrant.findMany({
      where,
      include: { resource: true },
      orderBy: { grantedAt: 'desc' },
      skip,
      take,
    }),
  ]);

  res.json(paginatedResult(grants.map((g) => toRecipientResponse(g.resource)), total, page, pageSize));
}));

// GET /api/me/resources/:id — 404 (never 403) for a nonexistent id, an
// inactive Resource, or one the caller has no ACTIVE grant for — a guessed
// id can never be distinguished from a real one that isn't the caller's,
// matching the non-disclosure convention already used across every other
// recipient surface in this codebase.
router.get('/:id', asyncHandler(async (req, res) => {
  const personId = req.resourceRecipientPersonId!;
  const { id } = req.params;

  const resource = await prisma.resource.findUnique({ where: { id } });
  if (!resource || !resource.active) {
    return res.status(404).json({ error: 'Resource not found.' });
  }

  const hasAccess = await hasResourceAccess(personId, id);
  if (!hasAccess) {
    return res.status(404).json({ error: 'Resource not found.' });
  }

  res.json(toRecipientResponse(resource));
}));

export default router;
