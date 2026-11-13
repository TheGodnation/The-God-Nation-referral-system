import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { requireCsrf } from '../lib/csrf';
import { asyncHandler } from '../lib/asyncHandler';
import { recordAudit } from '../lib/audit';
import { communityMutationLimiter } from '../lib/rateLimit';
import { CertificateError, NAME_PATTERN, cleanName, issueCertificate } from '../lib/certificates';
import { notifyCertificateIssued } from '../lib/notifications';

// ---------------------------------------------------------------------------
// /api/admin/certificates — the central admin's list of certificate requests: who asked, how they want to receive
// it, a private note (the price agreed, never shown to the student), and the steps: paid, issued (gets its number and
// date), delivered, or cancelled.
// ---------------------------------------------------------------------------

const router = Router();
router.use(requireAuth, requireRole('ADMIN'));

function audit(req: any, action: string, id: string, metadata?: Record<string, unknown>) {
  return recordAudit({ actorId: req.user!.id, actorEmail: req.user!.email, action, targetType: 'CertificateRequest', targetId: id, metadata });
}

const include = { person: { select: { id: true, name: true, whatsappNumber: true, preferredLanguage: true, memberAccount: { select: { email: true } } } } } as const;

function shape(r: any) {
  return {
    id: r.id,
    personId: r.person.id,
    accountName: r.person.name,
    whatsappNumber: r.person.whatsappNumber,
    email: r.person.memberAccount?.email ?? null,
    nameOnCertificate: r.nameOnCertificate,
    language: r.language === 'fr' ? 'fr' : 'en',
    delivery: r.delivery,
    contactPhone: r.contactPhone,
    address: r.address,
    status: r.status,
    adminNote: r.adminNote,
    certificateNumber: r.certificateNumber,
    issuedAt: r.issuedAt,
    paidAt: r.paidAt,
    deliveredAt: r.deliveredAt,
    requestedAt: r.requestedAt,
    booksPassed: r.booksPassed,
  };
}

router.get('/', asyncHandler(async (req, res) => {
  const status = z.enum(['REQUESTED', 'PAID', 'ISSUED', 'DELIVERED', 'CANCELLED']).safeParse(req.query.status);
  const rows = await prisma.certificateRequest.findMany({
    where: status.success ? { status: status.data } : {},
    orderBy: { requestedAt: 'desc' },
    take: 500,
    include,
  });
  const open = await prisma.certificateRequest.count({ where: { status: { in: ['REQUESTED', 'PAID'] } } });
  res.json({ items: rows.map(shape), open });
}));

const patchSchema = z.object({
  nameOnCertificate: z.string().transform(cleanName).refine((n) => NAME_PATTERN.test(n), 'Write the name as it should be printed.').optional(),
  adminNote: z.string().trim().max(1000).optional(),
  delivery: z.enum(['POST', 'EMAIL', 'COLLECT']).optional(),
  language: z.enum(['en', 'fr']).optional(),
  contactPhone: z.string().trim().max(30).optional(),
  address: z.string().trim().max(300).optional(),
});

router.patch('/:id', communityMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request.' });
  const d = parsed.data;
  const existing = await prisma.certificateRequest.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Request not found.' });
  // Once issued, the printed name and number are fixed (the note and delivery details can still be kept up to date).
  if ((existing.status === 'ISSUED' || existing.status === 'DELIVERED') && (d.nameOnCertificate !== undefined || d.language !== undefined)) {
    return res.status(409).json({ error: 'It is already issued: the name and language can no longer be changed.', code: 'ISSUED' });
  }
  const row = await prisma.certificateRequest.update({
    where: { id: existing.id },
    data: {
      ...(d.nameOnCertificate !== undefined ? { nameOnCertificate: d.nameOnCertificate } : {}),
      ...(d.adminNote !== undefined ? { adminNote: d.adminNote || null } : {}),
      ...(d.delivery !== undefined ? { delivery: d.delivery } : {}),
      ...(d.language !== undefined ? { language: d.language } : {}),
      ...(d.contactPhone !== undefined ? { contactPhone: d.contactPhone || null } : {}),
      ...(d.address !== undefined ? { address: d.address || null } : {}),
    },
    include,
  });
  await audit(req, 'CERTIFICATE_UPDATED', row.id);
  res.json({ item: shape(row) });
}));

async function step(req: any, res: any, action: string, run: (id: string) => Promise<unknown>) {
  const existing = await prisma.certificateRequest.findUnique({ where: { id: req.params.id }, select: { id: true, personId: true } });
  if (!existing) return res.status(404).json({ error: 'Request not found.' });
  try {
    await run(existing.id);
  } catch (err) {
    if (err instanceof CertificateError) return res.status(err.code === 'NOT_FOUND' ? 404 : 409).json({ error: err.message, code: err.code });
    throw err;
  }
  await audit(req, action, existing.id);
  const row = await prisma.certificateRequest.findUnique({ where: { id: existing.id }, include });
  return res.json({ item: shape(row) });
}

// Money received (the price was agreed privately).
router.post('/:id/paid', communityMutationLimiter, requireCsrf, asyncHandler((req, res) =>
  step(req, res, 'CERTIFICATE_PAID', async (id) => {
    const row = await prisma.certificateRequest.findUnique({ where: { id } });
    if (row?.status === 'REQUESTED') await prisma.certificateRequest.update({ where: { id }, data: { status: 'PAID', paidAt: new Date() } });
  })));

// Issued: gets its number and date; the student is told.
router.post('/:id/issue', communityMutationLimiter, requireCsrf, asyncHandler((req, res) =>
  step(req, res, 'CERTIFICATE_ISSUED', async (id) => {
    const before = await prisma.certificateRequest.findUnique({ where: { id }, select: { status: true, personId: true } });
    const row = await issueCertificate(id);
    if (before && before.status !== 'ISSUED' && before.status !== 'DELIVERED') await notifyCertificateIssued(row.personId).catch(() => {});
  })));

// Posted, sent or collected.
router.post('/:id/delivered', communityMutationLimiter, requireCsrf, asyncHandler((req, res) =>
  step(req, res, 'CERTIFICATE_DELIVERED', async (id) => {
    const row = await prisma.certificateRequest.findUnique({ where: { id } });
    if (!row || row.status === 'CANCELLED') throw new CertificateError('CANCELLED', 'This request was cancelled.');
    if (row.status !== 'ISSUED' && row.status !== 'DELIVERED') throw new CertificateError('NOT_ISSUED', 'Issue it first.');
    if (row.status === 'ISSUED') await prisma.certificateRequest.update({ where: { id }, data: { status: 'DELIVERED', deliveredAt: new Date() } });
  })));

// Cancelled (a request not yet issued): the student may ask again.
router.post('/:id/cancel', communityMutationLimiter, requireCsrf, asyncHandler((req, res) =>
  step(req, res, 'CERTIFICATE_CANCELLED', async (id) => {
    const row = await prisma.certificateRequest.findUnique({ where: { id } });
    if (row && (row.status === 'ISSUED' || row.status === 'DELIVERED')) throw new CertificateError('ISSUED', 'It is already issued and has a number, so it cannot be cancelled.');
    await prisma.certificateRequest.update({ where: { id }, data: { status: 'CANCELLED' } });
  })));

export default router;
