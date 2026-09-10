import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole, hashToken } from '../lib/auth';
import { parsePagination, paginatedResult } from '../lib/pagination';
import { recordAudit } from '../lib/audit';
import { requireCsrf } from '../lib/csrf';
import { adminSensitiveLimiter } from '../lib/rateLimit';
import { EmailService } from '../lib/email';
import { APP_URL, CLIENT_URL, LEADER_SETUP_TOKEN_TTL_MS } from '../lib/env';

const router = Router();

router.use(requireAuth, requireRole('ADMIN'));

async function issueLeaderSetupInvitation(leaderId: string, name: string, email: string) {
  // Section 32: invalidate any previous unconsumed setup token for this
  // Leader before issuing a new one, so only the latest link ever works.
  await prisma.leaderSetupToken.updateMany({
    where: { leaderId, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + LEADER_SETUP_TOKEN_TTL_MS);

  await prisma.leaderSetupToken.create({
    data: { leaderId, tokenHash, expiresAt },
  });

  const setupUrl = `${CLIENT_URL}/leader/setup?token=${rawToken}`;
  const result = await EmailService.sendLeaderInvitation({ to: email, name, setupUrl });
  return result.ok;
}

function includeTestData(req: any): boolean {
  return req.query.includeTestData === 'true';
}

// ---------------------------------------------------------------------------
// Dashboard / analytics
// ---------------------------------------------------------------------------

router.get('/dashboard', async (req, res) => {
  const testFilter = includeTestData(req) ? {} : { isTestData: false };

  const [totalVisits, uniqueVisitorRows, registrations, whatsappClicks, activeLeaders] =
    await Promise.all([
      prisma.referralVisit.count({ where: testFilter }),
      prisma.referralVisit.findMany({
        where: testFilter,
        select: { visitorId: true },
        distinct: ['visitorId'],
      }),
      prisma.registration.count({ where: testFilter }),
      prisma.event.count({ where: { type: 'WHATSAPP_CLICKED', ...testFilter } }),
      prisma.user.count({ where: { role: 'LEADER', active: true, ...(includeTestData(req) ? {} : { isTestData: false }) } }),
    ]);

  const uniqueVisitors = uniqueVisitorRows.length;
  const conversionRate = uniqueVisitors > 0 ? (registrations / uniqueVisitors) * 100 : 0;

  res.json({
    totalVisits,
    uniqueVisitors,
    registrations,
    whatsappClicks,
    activeLeaders,
    conversionRate: Math.round(conversionRate * 100) / 100,
    funnel: {
      visit: totalVisits,
      registration: registrations,
      whatsappClick: whatsappClicks,
    },
  });
});

const analyticsQuerySchema = z.object({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  leaderId: z.string().optional(),
  language: z.enum(['en', 'fr']).optional(),
  utmSource: z.string().optional(),
  utmCampaign: z.string().optional(),
  includeTestData: z.string().optional(),
});

router.get('/analytics', async (req, res) => {
  const q = analyticsQuerySchema.parse(req.query);
  const testFilter = q.includeTestData === 'true' ? {} : { isTestData: false };

  const dateFilter: Prisma.DateTimeFilter = {};
  if (q.dateFrom) dateFilter.gte = new Date(q.dateFrom);
  if (q.dateTo) dateFilter.lte = new Date(q.dateTo);
  const hasDateFilter = Boolean(q.dateFrom || q.dateTo);

  const visitWhere: Prisma.ReferralVisitWhereInput = {
    ...testFilter,
    ...(hasDateFilter ? { timestamp: dateFilter } : {}),
    ...(q.language ? { language: q.language } : {}),
    ...(q.utmSource ? { utmSource: q.utmSource } : {}),
    ...(q.utmCampaign ? { utmCampaign: q.utmCampaign } : {}),
    ...(q.leaderId ? { referralCode: { leaderId: q.leaderId } } : {}),
  };

  const regWhere: Prisma.RegistrationWhereInput = {
    ...testFilter,
    ...(hasDateFilter ? { createdAt: dateFilter } : {}),
    ...(q.language ? { language: q.language } : {}),
    ...(q.utmSource ? { utmSource: q.utmSource } : {}),
    ...(q.utmCampaign ? { utmCampaign: q.utmCampaign } : {}),
    ...(q.leaderId ? { relationship: { leaderId: q.leaderId } } : {}),
  };

  const [totalVisits, referralVisits, nonReferralVisits, uniqueVisitorRows, registrations] =
    await Promise.all([
      prisma.referralVisit.count({ where: visitWhere }),
      prisma.referralVisit.count({ where: { ...visitWhere, referralCodeId: { not: null } } }),
      prisma.referralVisit.count({ where: { ...visitWhere, referralCodeId: null } }),
      prisma.referralVisit.findMany({
        where: visitWhere,
        select: { visitorId: true },
        distinct: ['visitorId'],
      }),
      prisma.registration.count({ where: regWhere }),
    ]);

  res.json({
    totalVisits,
    referralVisits,
    nonReferralVisits,
    uniqueVisitors: uniqueVisitorRows.length,
    registrations,
    conversionRate:
      uniqueVisitorRows.length > 0
        ? Math.round((registrations / uniqueVisitorRows.length) * 10000) / 100
        : 0,
  });
});

// ---------------------------------------------------------------------------
// Leader management
// ---------------------------------------------------------------------------

router.get('/leaders', async (req, res) => {
  const { page, pageSize, skip, take } = parsePagination(req);
  const where: Prisma.UserWhereInput = { role: 'LEADER' };

  const [total, leaders] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      include: { referralCodes: { where: { active: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
  ]);

  const items = leaders.map((l) => ({
    id: l.id,
    name: l.name,
    email: l.email,
    active: l.active,
    isTestData: l.isTestData,
    referralCode: l.referralCodes[0]?.code ?? null,
    createdAt: l.createdAt,
  }));

  res.json(paginatedResult(items, total, page, pageSize));
});

const createLeaderSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().email(),
  referralCode: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, 'Referral code may only contain letters, numbers, - and _'),
  isTestData: z.boolean().optional(),
});

router.post('/leaders', requireCsrf, async (req, res) => {
  const parsed = createLeaderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request.' });
  }
  const { name, email, referralCode, isTestData } = parsed.data;

  const existingCode = await prisma.referralCode.findUnique({ where: { code: referralCode } });
  if (existingCode) {
    return res.status(409).json({ error: 'This referral code is already assigned.' });
  }

  const existingEmail = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (existingEmail) {
    return res.status(409).json({ error: 'A user with this email already exists.' });
  }

  // Section 27/31: new Leaders are onboarded via a secure emailed setup
  // link, never a temporary password. The account still needs *some*
  // passwordHash (schema-required, never null) so a random, never-revealed
  // value is stored — it cannot be used to log in until setup is completed.
  const unusablePasswordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);

  const leader = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name,
        email: email.toLowerCase(),
        passwordHash: unusablePasswordHash,
        role: 'LEADER',
        isTestData: Boolean(isTestData),
        mustChangePassword: false,
      },
    });
    await tx.referralCode.create({
      data: { code: referralCode, leaderId: user.id, isTestData: Boolean(isTestData) },
    });
    return user;
  });

  const invitationSent = await issueLeaderSetupInvitation(leader.id, leader.name, leader.email);

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'LEADER_CREATED',
    targetType: 'User',
    targetId: leader.id,
    metadata: { name, email, referralCode, invitationSent },
  });

  res.status(201).json({
    id: leader.id,
    name: leader.name,
    email: leader.email,
    invitationSent,
  });
});

// POST /api/admin/leaders/:id/resend-invitation
// Section 32: Admin recovery when a Leader never received, lost, or let
// their setup invitation expire. Never sets or reveals a password directly.
router.post('/leaders/:id/resend-invitation', adminSensitiveLimiter, requireCsrf, async (req, res) => {
  const { id } = req.params;
  const leader = await prisma.user.findUnique({ where: { id } });
  if (!leader || leader.role !== 'LEADER') {
    return res.status(404).json({ error: 'Leader not found.' });
  }

  const invitationSent = await issueLeaderSetupInvitation(leader.id, leader.name, leader.email);

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'LEADER_INVITATION_RESENT',
    targetType: 'User',
    targetId: leader.id,
    metadata: { email: leader.email, invitationSent },
  });

  res.json({ invitationSent });
});

const patchLeaderSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().email().optional(),
  active: z.boolean().optional(),
  referralCode: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
});

router.patch('/leaders/:id', requireCsrf, async (req, res) => {
  const { id } = req.params;
  const parsed = patchLeaderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request.' });
  }
  const { name, active, referralCode } = parsed.data;
  const email = parsed.data.email?.toLowerCase();

  const leader = await prisma.user.findUnique({ where: { id } });
  if (!leader || leader.role !== 'LEADER') {
    return res.status(404).json({ error: 'Leader not found.' });
  }

  if (referralCode) {
    const existing = await prisma.referralCode.findUnique({ where: { code: referralCode } });
    if (existing && existing.leaderId !== id) {
      return res.status(409).json({ error: 'This referral code is already assigned.' });
    }
  }

  if (email && email !== leader.email) {
    const existingEmail = await prisma.user.findUnique({ where: { email } });
    if (existingEmail && existingEmail.id !== id) {
      return res.status(409).json({ error: 'A user with this email already exists.' });
    }
  }

  await prisma.$transaction(async (tx) => {
    if (name !== undefined || email !== undefined || active !== undefined) {
      await tx.user.update({ where: { id }, data: { name, email, active } });
    }

    if (referralCode) {
      // Section 7: deactivate the old code (preserving history) and create
      // a brand-new row for the same Leader. Historical ReferralVisit and
      // ReferralRelationship rows keep pointing at the old code / Leader ID.
      const oldCode = await tx.referralCode.findFirst({ where: { leaderId: id, active: true } });
      if (oldCode && oldCode.code !== referralCode) {
        await tx.referralCode.update({
          where: { id: oldCode.id },
          data: { active: false, deactivatedAt: new Date() },
        });
        await tx.referralCode.create({
          data: { code: referralCode, leaderId: id, isTestData: leader.isTestData },
        });
      } else if (!oldCode) {
        await tx.referralCode.create({
          data: { code: referralCode, leaderId: id, isTestData: leader.isTestData },
        });
      }
    }
  });

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'LEADER_UPDATED',
    targetType: 'User',
    targetId: id,
    metadata: { name, email, active, referralCode },
  });

  const updated = await prisma.user.findUnique({
    where: { id },
    include: { referralCodes: { where: { active: true } } },
  });

  res.json({
    id: updated!.id,
    name: updated!.name,
    email: updated!.email,
    active: updated!.active,
    referralCode: updated!.referralCodes[0]?.code ?? null,
  });
});

// ---------------------------------------------------------------------------
// Registrations / referrals (read-only, system-wide)
// ---------------------------------------------------------------------------

const listQuerySchema = z.object({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  leaderId: z.string().optional(),
  language: z.enum(['en', 'fr']).optional(),
  utmSource: z.string().optional(),
  utmCampaign: z.string().optional(),
  includeTestData: z.string().optional(),
});

router.get('/registrations', async (req, res) => {
  const { page, pageSize, skip, take } = parsePagination(req);
  const q = listQuerySchema.parse(req.query);
  const testFilter = q.includeTestData === 'true' ? {} : { isTestData: false };

  const dateFilter: Prisma.DateTimeFilter = {};
  if (q.dateFrom) dateFilter.gte = new Date(q.dateFrom);
  if (q.dateTo) dateFilter.lte = new Date(q.dateTo);

  const where: Prisma.RegistrationWhereInput = {
    ...testFilter,
    ...(q.dateFrom || q.dateTo ? { createdAt: dateFilter } : {}),
    ...(q.language ? { language: q.language } : {}),
    ...(q.utmSource ? { utmSource: q.utmSource } : {}),
    ...(q.utmCampaign ? { utmCampaign: q.utmCampaign } : {}),
    ...(q.leaderId ? { relationship: { leaderId: q.leaderId } } : {}),
  };

  const [total, registrations] = await Promise.all([
    prisma.registration.count({ where }),
    prisma.registration.findMany({
      where,
      include: { relationship: { include: { leader: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
  ]);

  const items = registrations.map((r) => ({
    id: r.id,
    name: r.name,
    whatsapp: r.normalizedWhatsApp,
    language: r.language,
    leader: r.relationship?.leader ? { id: r.relationship.leader.id, name: r.relationship.leader.name } : null,
    utmSource: r.utmSource,
    utmMedium: r.utmMedium,
    utmCampaign: r.utmCampaign,
    createdAt: r.createdAt,
    isTestData: r.isTestData,
  }));

  res.json(paginatedResult(items, total, page, pageSize));
});

// DELETE /registrations/:id — permanently removes a registration so its
// WhatsApp number is free to register again. normalizedWhatsApp is a hard
// unique constraint, so freeing it requires actually deleting the row, not
// just marking it inactive. Cascades already handle this safely:
// ReferralRelationship (onDelete: Cascade) goes with it; Event rows
// (onDelete: SetNull) keep existing for historical visit/click counts,
// just losing their link to this specific registration; ReferralVisit has
// no foreign key to Registration at all, so referral-attribution history
// is entirely unaffected.
router.delete('/registrations/:id', adminSensitiveLimiter, requireCsrf, async (req, res) => {
  const { id } = req.params;

  const registration = await prisma.registration.findUnique({ where: { id } });
  if (!registration) {
    return res.status(404).json({ error: 'Registration not found.' });
  }

  await prisma.registration.delete({ where: { id } });

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'REGISTRATION_DELETED',
    targetType: 'Registration',
    targetId: id,
    metadata: { whatsapp: registration.normalizedWhatsApp, name: registration.name },
  });

  res.json({ ok: true });
});

router.get('/referrals', async (req, res) => {
  const { page, pageSize, skip, take } = parsePagination(req);
  const q = listQuerySchema.parse(req.query);
  const testFilter = q.includeTestData === 'true' ? {} : { isTestData: false };

  const dateFilter: Prisma.DateTimeFilter = {};
  if (q.dateFrom) dateFilter.gte = new Date(q.dateFrom);
  if (q.dateTo) dateFilter.lte = new Date(q.dateTo);

  const where: Prisma.ReferralVisitWhereInput = {
    ...testFilter,
    ...(q.dateFrom || q.dateTo ? { timestamp: dateFilter } : {}),
    ...(q.language ? { language: q.language } : {}),
    ...(q.utmSource ? { utmSource: q.utmSource } : {}),
    ...(q.utmCampaign ? { utmCampaign: q.utmCampaign } : {}),
    ...(q.leaderId ? { referralCode: { leaderId: q.leaderId } } : {}),
  };

  const [total, visits] = await Promise.all([
    prisma.referralVisit.count({ where }),
    prisma.referralVisit.findMany({
      where,
      include: { referralCode: { include: { leader: true } } },
      orderBy: { timestamp: 'desc' },
      skip,
      take,
    }),
  ]);

  const items = visits.map((v) => ({
    id: v.id,
    visitorId: v.visitorId,
    leader: v.referralCode ? { id: v.referralCode.leaderId, name: v.referralCode.leader.name } : null,
    language: v.language,
    utmSource: v.utmSource,
    utmMedium: v.utmMedium,
    utmCampaign: v.utmCampaign,
    timestamp: v.timestamp,
    isTestData: v.isTestData,
  }));

  res.json(paginatedResult(items, total, page, pageSize));
});

router.get('/export', async (req, res) => {
  const testFilter = includeTestData(req) ? {} : { isTestData: false };
  const registrations = await prisma.registration.findMany({
    where: testFilter,
    include: { relationship: { include: { leader: true } } },
    orderBy: { createdAt: 'desc' },
    take: 5000,
  });

  const header = 'id,name,whatsapp,language,leader,utmSource,utmMedium,utmCampaign,createdAt\n';
  const rows = registrations
    .map((r) =>
      [
        r.id,
        JSON.stringify(r.name),
        r.normalizedWhatsApp,
        r.language,
        r.relationship?.leader.name ?? '',
        r.utmSource ?? '',
        r.utmMedium ?? '',
        r.utmCampaign ?? '',
        r.createdAt.toISOString(),
      ].join(','),
    )
    .join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="registrations.csv"');
  res.send(header + rows);
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

// Known, simple, admin-editable website copy keys (section 22). Not a full
// CMS — a flat set of named strings; anything missing falls back to the
// client's own built-in default text.
//
// Every piece of copy is bilingual: each base name below gets an "En" and
// an "Fr" key (e.g. homepageTitleEn / homepageTitleFr), so an Admin edit in
// one language can never silently override what the other language's
// visitors see — the two are stored, and served, completely independently.
const CONTENT_BASE_KEYS = [
  'homepageTitle',
  'homepageSubtitle',
  'heroSupport',
  'heroCta',
  'trainingTitle',
  'trainingSupporting',
  'trainingDescription',
  'trainingExplanation',
  'trainingCta',
  'discoverTitle',
  'discoverSupporting',
  'discoverDescription',
  'discoverCta',
  'visionTitle',
  'vision',
  'howTitle',
  'how1Title',
  'how1Body',
  'how2Title',
  'how2Body',
  'how3Title',
  'how3Body',
  'connectTitle',
  'footer',
  'contactInfo',
  'registrationPageText',
  'successPageText',
  // Visitor-facing email text — bilingual like everything else above, since
  // registrants and reminder recipients read in either language.
  'emailRegistrationConfirmationSubject',
  'emailRegistrationConfirmationBody',
  'emailWhatsappReminderSubject',
  'emailWhatsappReminderBody',
] as const;

const CONTENT_KEYS = CONTENT_BASE_KEYS.flatMap((k) => [`${k}En`, `${k}Fr`] as const);

// Operational emails (Leader invitation, password reset) go only to
// Leaders/Admins, who have no stored language preference — one version
// each, not an En/Fr pair.
const CONTENT_SINGLE_KEYS = [
  'emailLeaderInvitationSubject',
  'emailLeaderInvitationBody',
  'emailPasswordResetSubject',
  'emailPasswordResetBody',
] as const;

const ALL_CONTENT_KEYS = [...CONTENT_KEYS, ...CONTENT_SINGLE_KEYS] as const;

const contentSchema = z
  .object(Object.fromEntries(ALL_CONTENT_KEYS.map((k) => [k, z.string().max(5000).optional()])) as Record<
    (typeof ALL_CONTENT_KEYS)[number],
    z.ZodOptional<z.ZodString>
  >)
  .partial();

function settingsResponse(settings: {
  whatsappUrlEn: string | null;
  whatsappUrlFr: string | null;
  whatsappUrlDiscoverEn: string | null;
  whatsappUrlDiscoverFr: string | null;
  supportWhatsappUrl: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  tiktokUrl: string | null;
  youtubeUrl: string | null;
  whatsappContactUrl: string | null;
  telegramUrl: string | null;
  messengerUrl: string | null;
  content: unknown;
} | null) {
  return {
    whatsappUrlEn: settings?.whatsappUrlEn ?? null,
    whatsappUrlFr: settings?.whatsappUrlFr ?? null,
    whatsappUrlDiscoverEn: settings?.whatsappUrlDiscoverEn ?? null,
    whatsappUrlDiscoverFr: settings?.whatsappUrlDiscoverFr ?? null,
    supportWhatsappUrl: settings?.supportWhatsappUrl ?? null,
    facebookUrl: settings?.facebookUrl ?? null,
    instagramUrl: settings?.instagramUrl ?? null,
    tiktokUrl: settings?.tiktokUrl ?? null,
    youtubeUrl: settings?.youtubeUrl ?? null,
    whatsappContactUrl: settings?.whatsappContactUrl ?? null,
    telegramUrl: settings?.telegramUrl ?? null,
    messengerUrl: settings?.messengerUrl ?? null,
    content: (settings?.content as Record<string, string> | null) ?? {},
  };
}

router.get('/settings', async (_req, res) => {
  const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } });
  res.json(settingsResponse(settings));
});

const settingsSchema = z.object({
  whatsappUrlEn: z.string().url().optional().nullable(),
  whatsappUrlFr: z.string().url().optional().nullable(),
  whatsappUrlDiscoverEn: z.string().url().optional().nullable(),
  whatsappUrlDiscoverFr: z.string().url().optional().nullable(),
  supportWhatsappUrl: z.string().url().optional().nullable(),
  facebookUrl: z.string().url().optional().nullable(),
  instagramUrl: z.string().url().optional().nullable(),
  tiktokUrl: z.string().url().optional().nullable(),
  youtubeUrl: z.string().url().optional().nullable(),
  whatsappContactUrl: z.string().url().optional().nullable(),
  telegramUrl: z.string().url().optional().nullable(),
  messengerUrl: z.string().url().optional().nullable(),
  content: contentSchema.optional(),
});

router.patch('/settings', requireCsrf, async (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid settings.' });
  }
  const d = parsed.data;

  const existing = await prisma.settings.findUnique({ where: { id: 'singleton' } });
  const mergedContent = {
    ...((existing?.content as Record<string, string> | null) ?? {}),
    ...(d.content ?? {}),
  };

  const scalarFields = {
    ...(d.whatsappUrlEn !== undefined ? { whatsappUrlEn: d.whatsappUrlEn } : {}),
    ...(d.whatsappUrlFr !== undefined ? { whatsappUrlFr: d.whatsappUrlFr } : {}),
    ...(d.whatsappUrlDiscoverEn !== undefined ? { whatsappUrlDiscoverEn: d.whatsappUrlDiscoverEn } : {}),
    ...(d.whatsappUrlDiscoverFr !== undefined ? { whatsappUrlDiscoverFr: d.whatsappUrlDiscoverFr } : {}),
    ...(d.supportWhatsappUrl !== undefined ? { supportWhatsappUrl: d.supportWhatsappUrl } : {}),
    ...(d.facebookUrl !== undefined ? { facebookUrl: d.facebookUrl } : {}),
    ...(d.instagramUrl !== undefined ? { instagramUrl: d.instagramUrl } : {}),
    ...(d.tiktokUrl !== undefined ? { tiktokUrl: d.tiktokUrl } : {}),
    ...(d.youtubeUrl !== undefined ? { youtubeUrl: d.youtubeUrl } : {}),
    ...(d.whatsappContactUrl !== undefined ? { whatsappContactUrl: d.whatsappContactUrl } : {}),
    ...(d.telegramUrl !== undefined ? { telegramUrl: d.telegramUrl } : {}),
    ...(d.messengerUrl !== undefined ? { messengerUrl: d.messengerUrl } : {}),
  };

  const settings = await prisma.settings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', ...scalarFields, content: mergedContent, updatedByUserId: req.user!.id },
    update: { ...scalarFields, ...(d.content ? { content: mergedContent } : {}), updatedByUserId: req.user!.id },
  });

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'SETTINGS_UPDATED',
    targetType: 'Settings',
    targetId: 'singleton',
    metadata: { changedKeys: Object.keys(req.body ?? {}) },
  });

  res.json(settingsResponse(settings));
});

// ---------------------------------------------------------------------------
// WhatsApp join reminders
// ---------------------------------------------------------------------------

// A registrant qualifies for a reminder when: they left an email address,
// they haven't already clicked the WhatsApp join link (no WHATSAPP_CLICKED
// event recorded against their registration), and — unless the Admin has
// "include test data" on — they aren't test data.
function reminderWhere(withTestData: boolean): Prisma.RegistrationWhereInput {
  return {
    email: { not: null },
    ...(withTestData ? {} : { isTestData: false }),
    events: { none: { type: 'WHATSAPP_CLICKED' } },
  };
}

// GET /api/admin/whatsapp-reminders/count — lets the Admin see exactly how
// many people are about to be emailed before committing to send anything.
router.get('/whatsapp-reminders/count', async (req, res) => {
  const count = await prisma.registration.count({ where: reminderWhere(includeTestData(req)) });
  res.json({ count });
});

// POST /api/admin/whatsapp-reminders/send — Admin-triggered only, never
// automatic. Sends the same reminder to everyone currently qualifying.
router.post('/whatsapp-reminders/send', adminSensitiveLimiter, requireCsrf, async (req, res) => {
  const registrations = await prisma.registration.findMany({
    where: reminderWhere(includeTestData(req)),
    select: { id: true, name: true, email: true, language: true },
  });

  let sent = 0;
  let failed = 0;
  for (const r of registrations) {
    // r.email is guaranteed non-null by reminderWhere's `email: { not: null }`.
    const link = `${APP_URL}/api/registrations/${r.id}/whatsapp`;
    const result = await EmailService.sendWhatsAppReminder({ to: r.email!, name: r.name, language: r.language, link });
    if (result.ok) sent++;
    else failed++;
  }

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'WHATSAPP_REMINDER_BULK_SENT',
    targetType: 'Registration',
    metadata: { attempted: registrations.length, sent, failed },
  });

  res.json({ attempted: registrations.length, sent, failed });
});

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

router.get('/audit', async (req, res) => {
  const { page, pageSize, skip, take } = parsePagination(req);
  const [total, logs] = await Promise.all([
    prisma.auditLog.count(),
    prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, skip, take }),
  ]);
  res.json(paginatedResult(logs, total, page, pageSize));
});

export default router;
