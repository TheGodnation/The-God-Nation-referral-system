import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireMember } from '../lib/memberAuth';
import { asyncHandler } from '../lib/asyncHandler';
import { parsePagination, paginatedResult } from '../lib/pagination';
import { profilePhotoPath } from '../lib/profilePhoto';
import { getOrCreatePersonReferralCode } from '../lib/referralCode';
import { CLIENT_URL } from '../lib/env';

const router = Router();

// ---------------------------------------------------------------------------
// /api/member/referrals — a Member's own referral link and "My Referrals"
// page. Mirrors /api/leader/links and /api/leader/referrals exactly, scoped
// to a Person (ReferralCode.personId) instead of a Leader User. Every Person
// now gets their code eagerly at signup (memberAuth.ts's /signup/finish) —
// this lookup only still falls back to creating one for a Person who
// predates that (see getOrCreatePersonReferralCode).
// ---------------------------------------------------------------------------

router.get('/referrals/links', requireMember, asyncHandler(async (req, res) => {
  const me = req.member!;
  const code = await getOrCreatePersonReferralCode(prisma, me.personId, me.name);
  res.json({
    referralCode: code.code,
    links: {
      en: `${CLIENT_URL}/join?ref=${code.code}&lang=en`,
      fr: `${CLIENT_URL}/join?ref=${code.code}&lang=fr`,
    },
  });
}));

// GET /api/member/referrals/mine — everyone who joined the app through
// this Member's link. Every row already completed real Member signup
// (Person + MemberAccount together, see memberAuth.ts), so unlike the
// Leader's pre-membership WhatsApp-click funnel there is no separate
// "joined" step to track here.
const DAY = 24 * 60 * 60 * 1000;

type InviteeStatus = 'NOT_CONFIRMED' | 'PROFILE_INCOMPLETE' | 'QUIET' | 'ACTIVE';

/** How far someone who joined through this link has got, so their inviter knows who to encourage. */
function statusOf(
  p: { profileCompletedAt: Date | null; lastSeenAt: Date | null; memberAccount: { lastLoginAt: Date | null } | null },
  quietBefore: Date,
): InviteeStatus {
  if (!p.memberAccount?.lastLoginAt) return 'NOT_CONFIRMED';
  if (!p.profileCompletedAt) return 'PROFILE_INCOMPLETE';
  const last = p.lastSeenAt ?? p.profileCompletedAt;
  return last < quietBefore ? 'QUIET' : 'ACTIVE';
}

// GET /api/member/referrals/mine — everyone who joined the app through this
// Member's link, and how far each one has got: not signed in yet, still to give
// their name and place, quiet for a while, or active. A leader also gets the
// WhatsApp number (leaders may already see member details, see the privacy page);
// everyone else reaches them through the app's own messages.
router.get('/referrals/mine', requireMember, asyncHandler(async (req, res) => {
  const me = req.member!.personId;
  const { page, pageSize, skip, take } = parsePagination(req);
  const where = { referredByPersonId: me };
  const person = {
    select: {
      id: true, name: true, photoStorageKey: true, photoUpdatedAt: true, whatsappNumber: true, preferredLanguage: true,
      profileCompletedAt: true, lastSeenAt: true, memberAccount: { select: { lastLoginAt: true } },
    },
  } as const;

  const [settings, leader, total, registrations, everyone] = await Promise.all([
    prisma.settings.findUnique({ where: { id: 'singleton' }, select: { reminderQuietDays: true } }),
    prisma.user.findFirst({ where: { personId: me, role: 'LEADER', active: true }, select: { id: true } }),
    prisma.registration.count({ where }),
    prisma.registration.findMany({ where, include: { person }, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.registration.findMany({ where, take: 2000, select: { person: { select: { profileCompletedAt: true, lastSeenAt: true, memberAccount: { select: { lastLoginAt: true } } } } } }),
  ]);
  const quietDays = settings?.reminderQuietDays ?? 7;
  const quietBefore = new Date(Date.now() - quietDays * DAY);

  const summary: Record<InviteeStatus, number> = { NOT_CONFIRMED: 0, PROFILE_INCOMPLETE: 0, QUIET: 0, ACTIVE: 0 };
  for (const r of everyone) if (r.person) summary[statusOf(r.person, quietBefore)] += 1;

  // A leader is also told who has not yet tapped "join our WhatsApp group", so they know who to send the links to first.
  const tapped = new Set<string>();
  if (leader && registrations.length) {
    const events = await prisma.event.findMany({
      where: { type: { in: ['WHATSAPP_CLICKED', 'GROUP_LINK_CLICKED'] }, registrationId: { in: registrations.map((r) => r.id) } },
      select: { registrationId: true },
    });
    for (const e of events) if (e.registrationId) tapped.add(e.registrationId);
  }

  const items = registrations
    .filter((r) => r.person)
    .map((r) => {
      const p = r.person!;
      const status = statusOf(p, quietBefore);
      const last = p.lastSeenAt ?? p.profileCompletedAt;
      return {
        ...(leader ? { tappedGroup: tapped.has(r.id) } : {}),
        personId: p.id,
        name: p.name,
        photoUrl: profilePhotoPath(p),
        joinedAt: r.createdAt,
        status,
        language: p.preferredLanguage === 'fr' ? 'fr' : 'en',
        daysQuiet: status === 'QUIET' && last ? Math.floor((Date.now() - last.getTime()) / DAY) : null,
        ...(leader ? { whatsapp: p.whatsappNumber } : {}),
      };
    });

  res.json({ ...paginatedResult(items, total, page, pageSize), summary, quietDays, canSeeWhatsapp: Boolean(leader) });
}));

export default router;
