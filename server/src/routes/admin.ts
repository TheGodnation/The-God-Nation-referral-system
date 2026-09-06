import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { parsePagination, paginatedResult } from '../lib/pagination';
import { recordAudit } from '../lib/audit';
import { requireCsrf } from '../lib/csrf';

const router = Router();

router.use(requireAuth, requireRole('ADMIN'));

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

  const tempPassword = crypto.randomBytes(12).toString('base64url');
  const passwordHash = await bcrypt.hash(tempPassword, 12);

  const leader = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name,
        email: email.toLowerCase(),
        passwordHash,
        role: 'LEADER',
        isTestData: Boolean(isTestData),
        mustChangePassword: true,
      },
    });
    await tx.referralCode.create({
      data: { code: referralCode, leaderId: user.id, isTestData: Boolean(isTestData) },
    });
    return user;
  });

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'LEADER_CREATED',
    targetType: 'User',
    targetId: leader.id,
    metadata: { name, email, referralCode },
  });

  res.status(201).json({
    id: leader.id,
    name: leader.name,
    email: leader.email,
    temporaryPassword: tempPassword,
  });
});

const patchLeaderSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
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
    return res.status(400).json({ error: 'Invalid request.' });
  }
  const { name, active, referralCode } = parsed.data;

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

  await prisma.$transaction(async (tx) => {
    if (name !== undefined || active !== undefined) {
      await tx.user.update({ where: { id }, data: { name, active } });
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
    metadata: { name, active, referralCode },
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

router.get('/settings', async (_req, res) => {
  const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } });
  res.json({
    whatsappUrlEn: settings?.whatsappUrlEn ?? null,
    whatsappUrlFr: settings?.whatsappUrlFr ?? null,
  });
});

const settingsSchema = z.object({
  whatsappUrlEn: z.string().url().optional().nullable(),
  whatsappUrlFr: z.string().url().optional().nullable(),
});

router.patch('/settings', requireCsrf, async (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Please provide valid WhatsApp URLs.' });
  }

  const settings = await prisma.settings.upsert({
    where: { id: 'singleton' },
    create: {
      id: 'singleton',
      whatsappUrlEn: parsed.data.whatsappUrlEn ?? null,
      whatsappUrlFr: parsed.data.whatsappUrlFr ?? null,
      updatedByUserId: req.user!.id,
    },
    update: {
      ...(parsed.data.whatsappUrlEn !== undefined ? { whatsappUrlEn: parsed.data.whatsappUrlEn } : {}),
      ...(parsed.data.whatsappUrlFr !== undefined ? { whatsappUrlFr: parsed.data.whatsappUrlFr } : {}),
      updatedByUserId: req.user!.id,
    },
  });

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'SETTINGS_UPDATED',
    targetType: 'Settings',
    targetId: 'singleton',
    metadata: { whatsappUrlEn: settings.whatsappUrlEn, whatsappUrlFr: settings.whatsappUrlFr },
  });

  res.json({ whatsappUrlEn: settings.whatsappUrlEn, whatsappUrlFr: settings.whatsappUrlFr });
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
