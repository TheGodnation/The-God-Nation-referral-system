import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { parsePagination, paginatedResult } from '../lib/pagination';
import { CLIENT_URL } from '../lib/env';
import { asyncHandler } from '../lib/asyncHandler';
import { requireLinkedPerson, findActiveScopedRole } from '../lib/leadership';
import { computeTrainingProgressForPerson } from '../lib/trainingProgress';

const router = Router();

router.use(requireAuth, requireRole('LEADER'));

async function getLeaderCodeIds(leaderId: string) {
  const codes = await prisma.referralCode.findMany({ where: { leaderId }, select: { id: true } });
  return codes.map((c) => c.id);
}

// GET /api/leader/dashboard — a Leader sees ONLY their own data.
router.get('/dashboard', asyncHandler(async (req, res) => {
  const leaderId = req.user!.id;
  const codeIds = await getLeaderCodeIds(leaderId);

  const [totalVisits, uniqueVisitorRows, registrations, whatsappClicks, activeCode] = await Promise.all([
    prisma.referralVisit.count({ where: { referralCodeId: { in: codeIds } } }),
    prisma.referralVisit.findMany({
      where: { referralCodeId: { in: codeIds } },
      select: { visitorId: true },
      distinct: ['visitorId'],
    }),
    prisma.referralRelationship.count({ where: { leaderId } }),
    prisma.event.count({
      where: { type: 'WHATSAPP_CLICKED', registration: { relationship: { leaderId } } },
    }),
    prisma.referralCode.findFirst({ where: { leaderId, active: true } }),
  ]);

  const uniqueVisitors = uniqueVisitorRows.length;
  const conversion = uniqueVisitors > 0 ? (registrations / uniqueVisitors) * 100 : 0;

  // Visit and registration counts are computed above only to derive the
  // conversion rate — they are deliberately NOT returned to the Leader.
  // Those numbers stay Admin-only (see admin.ts /dashboard and
  // /registrations, which already show them site-wide and per-leader);
  // a Leader sees only their WhatsApp clicks and conversion rate here.
  res.json({
    referralCode: activeCode?.code ?? null,
    stats: {
      whatsappClicks,
      conversionRate: Math.round(conversion * 100) / 100,
    },
  });
}));

// GET /api/leader/links
router.get('/links', asyncHandler(async (req, res) => {
  const leaderId = req.user!.id;
  const activeCode = await prisma.referralCode.findFirst({ where: { leaderId, active: true } });

  if (!activeCode) {
    return res.json({ referralCode: null, links: null, outreachLinks: null });
  }

  res.json({
    referralCode: activeCode.code,
    links: {
      en: `${CLIENT_URL}/join?ref=${activeCode.code}&lang=en`,
      fr: `${CLIENT_URL}/join?ref=${activeCode.code}&lang=fr`,
    },
    // A second pair of links landing on /welcome instead of the homepage —
    // for direct outreach (e.g. an evangelism message) rather than a warm
    // referral. Same attribution, same eventual WhatsApp community; just a
    // different first-contact page for people who've never heard of the
    // ministry before.
    outreachLinks: {
      en: `${CLIENT_URL}/welcome?ref=${activeCode.code}&lang=en`,
      fr: `${CLIENT_URL}/welcome?ref=${activeCode.code}&lang=fr`,
    },
  });
}));

// GET /api/leader/referrals — paginated list of this Leader's registrations.
router.get('/referrals', asyncHandler(async (req, res) => {
  const leaderId = req.user!.id;
  const { page, pageSize, skip, take } = parsePagination(req);

  const where = { leaderId };

  const [total, relationships] = await Promise.all([
    prisma.referralRelationship.count({ where }),
    prisma.referralRelationship.findMany({
      where,
      include: {
        registration: {
          // Only need to know whether a WHATSAPP_CLICKED event exists at
          // all for this registration — not its details — so this fetches
          // at most one, purely as a presence check.
          include: { events: { where: { type: 'WHATSAPP_CLICKED' }, take: 1 } },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
  ]);

  const items = relationships.map((r) => ({
    name: r.registration.name,
    whatsapp: r.registration.normalizedWhatsApp,
    language: r.registration.language,
    registeredAt: r.registration.createdAt,
    status: r.registration.status,
    // Whether this person has tapped through from the site to the
    // WhatsApp community — the same signal Admin's WhatsApp Join
    // Reminders already relies on, just surfaced per-referral here so a
    // Leader knows who to actually look for in the group.
    whatsappJoined: r.registration.events.length > 0,
  }));

  res.json(paginatedResult(items, total, page, pageSize));
}));

const communityProgressQuerySchema = z.object({ communityId: z.string().min(1) });

// GET /api/leader/community-progress?communityId=:id — Phase 3E. A Leader
// may view training progress ONLY for the exact Community they hold an
// ACTIVE SCOPED_LEADER RoleAssignment for (Phase 3D's existing exact-scope
// helper — no new authorization mechanism, no Geography variant, no
// parent/child coverage). Population is every Person with an ACTIVE
// CommunityMembership in that exact Community; former/inactive members are
// excluded. Reuses the existing pagination convention, same as every other
// paginated list in this codebase.
router.get('/community-progress', requireLinkedPerson, asyncHandler(async (req, res) => {
  const parsed = communityProgressQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'communityId is required.' });
  }
  const { communityId } = parsed.data;

  const role = await findActiveScopedRole(req.leaderPersonId!, 'COMMUNITY', communityId);
  if (!role) {
    return res.status(403).json({ error: 'You do not have an active scoped leader role for this exact Community.' });
  }

  const { page, pageSize, skip, take } = parsePagination(req);

  const where = { communityId, status: 'ACTIVE' as const };
  const [total, memberships] = await Promise.all([
    prisma.communityMembership.count({ where }),
    prisma.communityMembership.findMany({
      where,
      include: { person: { select: { id: true, name: true } } },
      orderBy: { joinedAt: 'asc' },
      skip,
      take,
    }),
  ]);

  // Each member's overall progress is computed the same way as the
  // Member/Admin person views (lib/trainingProgress.ts) — this endpoint is
  // deliberately simple (one query per page row) rather than a batched
  // cross-person analytics query, consistent with the "keep it simple, no
  // analytics infrastructure" scope for this phase.
  const items = await Promise.all(
    memberships.map(async (m) => {
      const progress = await computeTrainingProgressForPerson(m.person.id);
      const bestPercentage = progress.items.reduce<number | null>(
        (best, i) => (i.bestPercentage !== null && (best === null || i.bestPercentage > best) ? i.bestPercentage : best),
        null,
      );
      const lastAttemptAt = progress.items.reduce<Date | null>(
        (latest, i) => (i.lastAttemptAt && (!latest || i.lastAttemptAt > latest) ? i.lastAttemptAt : latest),
        null,
      );
      return {
        personId: m.person.id,
        name: m.person.name,
        totalEligible: progress.totalEligible,
        completedCount: progress.completedCount,
        completed: progress.totalEligible > 0 && progress.completedCount === progress.totalEligible,
        bestPercentage,
        lastAttemptAt,
      };
    }),
  );

  res.json(paginatedResult(items, total, page, pageSize));
}));

const rosterQuerySchema = z.object({
  scopeType: z.enum(['COMMUNITY', 'GEOGRAPHY']),
  scopeId: z.string().min(1),
});

// GET /api/leader/roster?scopeType=COMMUNITY|GEOGRAPHY&scopeId=:id — Phase
// 3H. A read-only roster of the People belonging to an exact scope the
// Leader currently holds an ACTIVE SCOPED_LEADER RoleAssignment for.
// Reuses Phase 3D's exact-scope authorization helper unmodified (no parent/
// child coverage, no hierarchy) and the existing pagination convention.
// Deliberately separate from FollowUpAssignment — this is visibility only,
// never a mutation or a path to create/act on a follow-up.
router.get('/roster', requireLinkedPerson, asyncHandler(async (req, res) => {
  const parsed = rosterQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'scopeType must be COMMUNITY or GEOGRAPHY, and scopeId is required.' });
  }
  const { scopeType, scopeId } = parsed.data;

  // Authorization is established before any population data is touched.
  // findActiveScopedRole matches personId + roleType SCOPED_LEADER + status
  // ACTIVE + the exact communityId/geographyId — the schema's own CHECK
  // constraint (exactly one of communityId/geographyId set, never both)
  // already guarantees this can never accidentally match the wrong scope
  // type. No exact match means 403 — the same response whether the scope
  // doesn't exist, belongs to someone else, or is a parent/child of one the
  // Leader actually holds, so the response never reveals which.
  const role = await findActiveScopedRole(req.leaderPersonId!, scopeType, scopeId);
  if (!role) {
    return res.status(403).json({
      error: `You do not have an active scoped leader role for this exact ${scopeType === 'COMMUNITY' ? 'Community' : 'Geography'}.`,
    });
  }

  const { page, pageSize, skip, take } = parsePagination(req);

  if (scopeType === 'COMMUNITY') {
    const where = { communityId: scopeId, status: 'ACTIVE' as const };
    const [total, memberships] = await Promise.all([
      prisma.communityMembership.count({ where }),
      prisma.communityMembership.findMany({
        where,
        include: { person: { select: { id: true, name: true } } },
        orderBy: { joinedAt: 'asc' },
        skip,
        take,
      }),
    ]);
    const items = memberships.map((m) => ({
      personId: m.person.id,
      name: m.person.name,
      membershipJoinedAt: m.joinedAt,
    }));
    return res.json({ scopeType, scopeId, ...paginatedResult(items, total, page, pageSize) });
  }

  const where = { geographyId: scopeId, status: 'ACTIVE' as const };
  const [total, assignments] = await Promise.all([
    prisma.geographicAssignment.count({ where }),
    prisma.geographicAssignment.findMany({
      where,
      include: { person: { select: { id: true, name: true } } },
      orderBy: { assignedAt: 'asc' },
      skip,
      take,
    }),
  ]);
  const items = assignments.map((a) => ({
    personId: a.person.id,
    name: a.person.name,
    geographicAssignedAt: a.assignedAt,
  }));
  res.json({ scopeType, scopeId, ...paginatedResult(items, total, page, pageSize) });
}));

// Section 26/39 originally let a Leader email their own referral link to
// someone via POST /api/leader/invite. Removed: with a shared daily Resend
// sending cap, every Leader having an open-ended "send an email" button
// could crowd out the emails that actually matter (registration
// confirmations, Leader invitations, WhatsApp reminders). Leaders still
// have WhatsApp, Messenger, copy-link, and the device's native share sheet
// (see LeaderDashboardPage) — those cost nothing and don't touch email.

export default router;
