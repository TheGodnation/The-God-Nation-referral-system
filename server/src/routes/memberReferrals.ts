import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { requireMember } from '../lib/memberAuth';
import { asyncHandler } from '../lib/asyncHandler';
import { parsePagination, paginatedResult } from '../lib/pagination';
import { profilePhotoPath } from '../lib/profilePhoto';
import { generateUniqueReferralCode } from '../lib/referralCode';
import { CLIENT_URL } from '../lib/env';

const router = Router();

// ---------------------------------------------------------------------------
// /api/member/referrals — a Member's own referral link and "My Referrals"
// page. Mirrors /api/leader/links and /api/leader/referrals exactly, scoped
// to a Person (ReferralCode.personId) instead of a Leader User. See
// ReferralCode/Registration.referredByPersonId comments in schema.prisma —
// forward-only, and a Member's own ReferralCode is never created until they
// first open this page (most members never will).
// ---------------------------------------------------------------------------

async function getOrCreateMyReferralCode(personId: string, name: string) {
  const existing = await prisma.referralCode.findUnique({ where: { personId } });
  if (existing) return existing;
  const code = await generateUniqueReferralCode(name);
  try {
    return await prisma.referralCode.create({ data: { code, personId } });
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    // Lost a race with a concurrent request for this same Member — the
    // other one won, so just return what it created.
    return prisma.referralCode.findUniqueOrThrow({ where: { personId } });
  }
}

router.get('/referrals/links', requireMember, asyncHandler(async (req, res) => {
  const me = req.member!;
  const code = await getOrCreateMyReferralCode(me.personId, me.name);
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
router.get('/referrals/mine', requireMember, asyncHandler(async (req, res) => {
  const me = req.member!.personId;
  const { page, pageSize, skip, take } = parsePagination(req);
  const where = { referredByPersonId: me };

  const [total, registrations] = await Promise.all([
    prisma.registration.count({ where }),
    prisma.registration.findMany({
      where,
      include: { person: { select: { id: true, name: true, photoStorageKey: true, photoUpdatedAt: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
  ]);

  const items = registrations
    .filter((r) => r.person)
    .map((r) => ({
      personId: r.person!.id,
      name: r.person!.name,
      photoUrl: profilePhotoPath(r.person!),
      joinedAt: r.createdAt,
    }));

  res.json(paginatedResult(items, total, page, pageSize));
}));

export default router;
