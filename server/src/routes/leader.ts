import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { parsePagination, paginatedResult } from '../lib/pagination';
import { CLIENT_URL } from '../lib/env';
import { requireCsrf } from '../lib/csrf';
import { leaderInviteLimiter } from '../lib/rateLimit';
import { EmailService } from '../lib/email';
import { recordAudit } from '../lib/audit';

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

// POST /api/leader/invite — section 26/39: the authenticated Leader emails
// their OWN referral link to someone. The referral code/link is always
// derived server-side from req.user.id; the client can never supply a
// Leader ID or referral code of its own.
const inviteSchema = z.object({
  email: z.string().trim().email(),
  language: z.enum(['en', 'fr']).optional().default('en'),
});

router.post('/invite', leaderInviteLimiter, requireCsrf, async (req, res) => {
  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Please provide a valid email address.' });
  }
  const leaderId = req.user!.id;
  const activeCode = await prisma.referralCode.findFirst({ where: { leaderId, active: true } });
  if (!activeCode) {
    return res.status(400).json({ error: 'You do not have an active referral code yet.' });
  }

  const referralLink = `${CLIENT_URL}/join?ref=${activeCode.code}&lang=${parsed.data.language}`;
  const result = await EmailService.sendLeaderReferralInvitation({
    to: parsed.data.email,
    leaderName: req.user!.name,
    referralLink,
  });

  await recordAudit({
    actorId: leaderId,
    actorEmail: req.user!.email,
    action: 'LEADER_REFERRAL_EMAIL_SENT',
    targetType: 'User',
    targetId: leaderId,
    metadata: { to: parsed.data.email, sent: result.ok },
  });

  res.json({ sent: result.ok });
});

export default router;
