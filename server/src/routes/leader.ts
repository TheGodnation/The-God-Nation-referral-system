import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { parsePagination, paginatedResult } from '../lib/pagination';
import { CLIENT_URL } from '../lib/env';
import { asyncHandler } from '../lib/asyncHandler';
import { requireLinkedPerson, findActiveScopedRole } from '../lib/leadership';
import { computeTrainingProgressForPerson } from '../lib/trainingProgress';
import { findLeaderPeers } from '../lib/leaderPeers';
import { normalizeToE164 } from '../lib/phone';
import { recordAudit } from '../lib/audit';
import { requireCsrf } from '../lib/csrf';
import { createMemberSession } from '../lib/memberAuth';
import { leadershipMutationLimiter } from '../lib/rateLimit';

const router = Router();

router.use(requireAuth, requireRole('LEADER'));

async function getLeaderCodeIds(leaderId: string) {
  const codes = await prisma.referralCode.findMany({ where: { leaderId }, select: { id: true } });
  return codes.map((c) => c.id);
}

// GET /api/leader/dashboard — a Leader sees ONLY their own data.
router.get('/dashboard', asyncHandler(async (req, res) => {
  const leaderId = req.user!.id;
  const personId = req.user!.personId;
  const codeIds = await getLeaderCodeIds(leaderId);

  const [totalVisits, uniqueVisitorRows, registrations, whatsappClicks, activeCode, memberAccount] = await Promise.all([
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
    // Only relevant once linked (see the Leader<->Member bridge below) — an
    // account linked before Member passwords existed may have none yet,
    // which the dashboard needs to know so it can offer to set one right
    // here instead of the Leader getting silently locked out of the phone
    // app's Member sign-in later.
    personId ? prisma.memberAccount.findUnique({ where: { personId }, select: { passwordHash: true } }) : null,
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
    // null: not linked to a Member profile at all yet.
    memberProfileHasPassword: personId ? Boolean(memberAccount?.passwordHash) : null,
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

// Leader <-> Member identity bridge (existing Leaders only — a Member
// promoted to Leader going forward never needs this, since they already
// have a Person; see RoleAssignment). This is the one-time, self-serve
// alternative to the Admin-only PATCH /api/admin/leaders/:id/link-person
// (Phase 3D) for a Leader who hasn't been linked yet: it also creates (or
// connects to) the actual MemberAccount so the Leader's own existing
// password session (sid) can, right here, additionally start a Member
// session (msid) — two cookies, one action, "both sides together" as the
// founder described it. Never changes sid itself: see
// memberSessionIsolation.test.ts for the boundary this must never cross.
const createMemberProfileSchema = z.object({
  whatsapp: z.string().trim().min(1).max(32),
  // Sets (or, for a legacy account reused below that has none yet,
  // backfills) the Member side's own password — without this, the Leader's
  // very first sign-out would permanently lock them out of the phone app's
  // Member sign-in, since there would be nothing to check a password
  // against there (see MemberAccount.passwordHash's schema comment).
  password: z.string().min(8, 'Please choose a password with at least 8 characters.').max(100),
  language: z.enum(['en', 'fr']).default('en'),
});

router.post('/me/create-member-profile', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = createMemberProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.path[0] === 'password') {
      return res.status(400).json({ error: issue.message });
    }
    return res.status(400).json({ error: 'Please enter a valid phone number, including the country code.' });
  }
  const normalizedWhatsApp = normalizeToE164(parsed.data.whatsapp);
  if (!normalizedWhatsApp) {
    return res.status(400).json({ error: 'Please enter a valid phone number, including the country code.' });
  }
  const passwordHash = await bcrypt.hash(parsed.data.password, 12);

  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return res.status(404).json({ error: 'Leader not found.' });
  if (user.personId) {
    return res.status(409).json({ error: 'Your account is already linked to a Member profile.' });
  }

  const normalizedEmail = user.email.toLowerCase();
  const existingPersonByPhone = await prisma.person.findUnique({
    where: { whatsappNumber: normalizedWhatsApp },
    include: { memberAccount: true },
  });

  if (existingPersonByPhone?.memberAccount && existingPersonByPhone.memberAccount.email !== normalizedEmail) {
    // Someone else's member account already owns this WhatsApp number —
    // never take it over based on an unverified claim.
    return res.status(409).json({ error: 'This WhatsApp number already belongs to a different member account. Please contact an Admin for help.' });
  }

  const conflictingAccount = await prisma.memberAccount.findUnique({ where: { email: normalizedEmail } });
  if (conflictingAccount && conflictingAccount.personId !== existingPersonByPhone?.id) {
    return res.status(409).json({ error: 'A different member profile already uses your email address. Please contact an Admin for help.' });
  }

  try {
    const { memberAccount, person } = await prisma.$transaction(async (tx) => {
      const person = existingPersonByPhone
        ?? (await tx.person.create({
          data: {
            name: user.name,
            whatsappNumber: normalizedWhatsApp,
            email: normalizedEmail,
            preferredLanguage: parsed.data.language,
            isTestData: user.isTestData,
          },
        }));

      const existingLinkForPerson = await tx.user.findUnique({ where: { personId: person.id } });
      if (existingLinkForPerson) {
        throw new Error('ALREADY_LINKED_TO_ANOTHER_USER');
      }

      const memberAccount = existingPersonByPhone?.memberAccount
        ? (existingPersonByPhone.memberAccount.passwordHash
            // Already has its own password (e.g. set through ordinary
            // Member sign-up) — never overwrite it from this flow.
            ? existingPersonByPhone.memberAccount
            : await tx.memberAccount.update({ where: { id: existingPersonByPhone.memberAccount.id }, data: { passwordHash } }))
        : await tx.memberAccount.create({ data: { personId: person.id, email: normalizedEmail, passwordHash } });

      await tx.user.update({ where: { id: user.id }, data: { personId: person.id } });

      return { memberAccount, person };
    });

    await recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: 'LEADER_SELF_LINKED_MEMBER_PROFILE',
      targetType: 'User',
      targetId: user.id,
      metadata: { personId: person.id, memberAccountId: memberAccount.id },
    });

    // The Leader is already proven to be this account's owner (their
    // existing password session) — sign them into the Member side right
    // now too, rather than send a magic-link email to themselves.
    await createMemberSession(memberAccount.id, res);

    res.status(201).json({ personId: person.id, personName: person.name });
  } catch (err) {
    if (err instanceof Error && err.message === 'ALREADY_LINKED_TO_ANOTHER_USER') {
      return res.status(409).json({ error: 'This phone number is already linked to a different account. Please contact an Admin for help.' });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return res.status(409).json({ error: 'That phone number or email is already in use. Please contact an Admin for help.' });
    }
    throw err;
  }
}));

// Backfill for a Leader who linked a Member profile before passwords
// existed on the Member side (see MemberAccount.passwordHash's schema
// comment) — their dashboard shows this instead of the plain "view
// profile" link until they set one, closing the exact lockout the create-
// member-profile endpoint above now prevents for everyone going forward.
const setMemberPasswordSchema = z.object({
  password: z.string().min(8, 'Please choose a password with at least 8 characters.').max(100),
});

router.post('/me/set-member-password', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = setMemberPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Please choose a password with at least 8 characters.' });
  }

  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user?.personId) {
    return res.status(400).json({ error: 'Link your account to a Member profile first.' });
  }
  const memberAccount = await prisma.memberAccount.findUnique({ where: { personId: user.personId } });
  if (!memberAccount) {
    return res.status(404).json({ error: 'No Member profile found.' });
  }
  if (memberAccount.passwordHash) {
    return res.status(409).json({ error: 'A password is already set for your Member profile.' });
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  await prisma.memberAccount.update({ where: { id: memberAccount.id }, data: { passwordHash } });

  await recordAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'LEADER_MEMBER_PASSWORD_SET',
    targetType: 'MemberAccount',
    targetId: memberAccount.id,
  });

  res.json({ ok: true });
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

// Geography Retirement Step 5B: scopeType now accepts only 'COMMUNITY' — a
// GEOGRAPHY request is rejected by rosterQuerySchema itself. Geography
// Retirement Step 5A previously retired Follow-Up's own Geography context;
// this retires the roster's.
const rosterQuerySchema = z.object({
  scopeType: z.enum(['COMMUNITY']),
  scopeId: z.string().min(1),
});

// GET /api/leader/roster?scopeType=COMMUNITY&scopeId=:id — Phase 3H. A
// read-only roster of the People belonging to a Community the Leader
// currently holds an ACTIVE SCOPED_LEADER RoleAssignment for, plus the
// existing pagination convention. Deliberately separate from
// FollowUpAssignment — this is visibility only, never a mutation or a path
// to create/act on a follow-up. Exact-scope only: a parent RoleAssignment
// never exposes a child Community's roster, and vice versa.
router.get('/roster', requireLinkedPerson, asyncHandler(async (req, res) => {
  const parsed = rosterQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'scopeType must be COMMUNITY, and scopeId is required.' });
  }
  const { scopeType, scopeId } = parsed.data;
  const { page, pageSize, skip, take } = parsePagination(req);

  // Authorization is established before any population data is touched.
  // findActiveScopedRole matches personId + roleType SCOPED_LEADER +
  // status ACTIVE + the exact communityId — unmodified from Phase 3H, no
  // parent/child coverage, no hierarchy. No exact match means 403 — the
  // same response whether the scope doesn't exist, belongs to someone
  // else, or is a parent/child of one the Leader actually holds, so the
  // response never reveals which.
  const role = await findActiveScopedRole(req.leaderPersonId!, scopeType, scopeId);
  if (!role) {
    return res.status(403).json({ error: 'You do not have an active scoped leader role for this exact Community.' });
  }

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
  res.json({ scopeType, scopeId, ...paginatedResult(items, total, page, pageSize) });
}));

// GET /api/leader/peers — Phase 2A. Read-only discovery of the requesting
// Leader's organizational-generation peers (see lib/leaderPeers.ts for the
// full authorization/derivation logic). No client-supplied Person id,
// Community id, or generation is ever accepted as an input — the entire
// result is derived solely from req.leaderPersonId's own ACTIVE
// Community-scoped SCOPED_LEADER RoleAssignment(s). Discovery only: no
// messaging, no recommendation, no appointment — that is explicitly out of
// scope for this phase (see lib/leaderPeers.ts's own module comment).
router.get('/peers', requireLinkedPerson, asyncHandler(async (req, res) => {
  const { page, pageSize, skip, take } = parsePagination(req);
  const all = await findLeaderPeers(req.leaderPersonId!);
  const items = all.slice(skip, skip + take);
  res.json(paginatedResult(items, all.length, page, pageSize));
}));

// Section 26/39 originally let a Leader email their own referral link to
// someone via POST /api/leader/invite. Removed: with a shared daily Resend
// sending cap, every Leader having an open-ended "send an email" button
// could crowd out the emails that actually matter (registration
// confirmations, Leader invitations, WhatsApp reminders). Leaders still
// have WhatsApp, Messenger, copy-link, and the device's native share sheet
// (see LeaderDashboardPage) — those cost nothing and don't touch email.

export default router;
