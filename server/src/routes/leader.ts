import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { parsePagination, paginatedResult } from '../lib/pagination';
import { CLIENT_URL } from '../lib/env';

const router = Router();

router.use(requireAuth, requireRole('LEADER'));

async function getLeaderCodeIds(leaderId: string) {
  const codes = await prisma.referralCode.findMany({ where: { leaderId }, select: { id: true } });
  return codes.map((c) => c.id);
}

// GET /api/leader/dashboard — a Leader sees ONLY their own data.
router.get('/dashboard', async (req, res) => {
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

  res.json({
    referralCode: activeCode?.code ?? null,
    stats: {
      totalVisits,
      uniqueVisitors,
      registrations,
      whatsappClicks,
      conversionRate: Math.round(conversion * 100) / 100,
    },
  });
});

// GET /api/leader/links
router.get('/links', async (req, res) => {
  const leaderId = req.user!.id;
  const activeCode = await prisma.referralCode.findFirst({ where: { leaderId, active: true } });

  if (!activeCode) {
    return res.json({ referralCode: null, links: null });
  }

  res.json({
    referralCode: activeCode.code,
    links: {
      en: `${CLIENT_URL}/join?ref=${activeCode.code}&lang=en`,
      fr: `${CLIENT_URL}/join?ref=${activeCode.code}&lang=fr`,
    },
  });
});

// GET /api/leader/referrals — paginated list of this Leader's registrations.
router.get('/referrals', async (req, res) => {
  const leaderId = req.user!.id;
  const { page, pageSize, skip, take } = parsePagination(req);

  const where = { leaderId };

  const [total, relationships] = await Promise.all([
    prisma.referralRelationship.count({ where }),
    prisma.referralRelationship.findMany({
      where,
      include: { registration: true },
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
  }));

  res.json(paginatedResult(items, total, page, pageSize));
});

// Section 26/39 originally let a Leader email their own referral link to
// someone via POST /api/leader/invite. Removed: with a shared daily Resend
// sending cap, every Leader having an open-ended "send an email" button
// could crowd out the emails that actually matter (registration
// confirmations, Leader invitations, WhatsApp reminders). Leaders still
// have WhatsApp, Messenger, copy-link, and the device's native share sheet
// (see LeaderDashboardPage) — those cost nothing and don't touch email.

export default router;
