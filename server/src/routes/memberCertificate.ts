import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireMember } from '../lib/memberAuth';
import { requireCsrf } from '../lib/csrf';
import { asyncHandler } from '../lib/asyncHandler';
import { socialMutationLimiter } from '../lib/rateLimit';
import { NAME_PATTERN, certificateEligibility, cleanName, studentView } from '../lib/certificates';
import { notifyCertificateRequested } from '../lib/notifications';

// ---------------------------------------------------------------------------
// /api/member/certificate — the student's side of the Academy diploma: whether they can ask for it, asking (name as
// it should be printed, how to receive it), and seeing where it stands. The price is never shown here.
// ---------------------------------------------------------------------------

const router = Router();

router.get('/certificate', requireMember, asyncHandler(async (req, res) => {
  const personId = req.member!.personId;
  const [eligibility, row, person] = await Promise.all([
    certificateEligibility(personId),
    prisma.certificateRequest.findUnique({ where: { personId } }),
    prisma.person.findUnique({ where: { id: personId }, select: { name: true, preferredLanguage: true } }),
  ]);
  res.json({
    ...eligibility,
    defaultName: person?.name ?? '',
    defaultLanguage: person?.preferredLanguage === 'fr' ? 'fr' : 'en',
    request: row && row.status !== 'CANCELLED' ? studentView(row) : null,
  });
}));

const requestSchema = z.object({
  name: z.string().transform(cleanName).refine((n) => NAME_PATTERN.test(n), 'Write your name as it should be printed (letters only).'),
  delivery: z.enum(['POST', 'EMAIL', 'COLLECT']),
  language: z.enum(['en', 'fr']).default('en'),
  phone: z.string().trim().max(30).optional(),
  address: z.string().trim().max(300).optional(),
});

// POST /api/member/certificate — ask for it (or change the request while it is still only a request).
router.post('/certificate', socialMutationLimiter, requireCsrf, requireMember, asyncHandler(async (req, res) => {
  const personId = req.member!.personId;
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request.' });
  const d = parsed.data;
  const phone = d.phone?.replace(/[^\d+\s()-]/g, '').trim() || null;
  if (d.delivery === 'POST') {
    if (!d.address || d.address.length < 8) return res.status(400).json({ error: 'Write the address where it should be posted.', code: 'ADDRESS' });
    if (!phone || phone.replace(/\D/g, '').length < 6) return res.status(400).json({ error: 'Add a phone number the post can reach you on.', code: 'PHONE' });
  }
  if (d.delivery === 'COLLECT' && (!phone || phone.replace(/\D/g, '').length < 6)) {
    return res.status(400).json({ error: 'Add a phone number so we can tell you when it is ready.', code: 'PHONE' });
  }
  const eligibility = await certificateEligibility(personId);
  if (!eligibility.eligible) return res.status(403).json({ error: 'You can ask for the certificate once you have passed every book.', code: 'NOT_ELIGIBLE' });

  const existing = await prisma.certificateRequest.findUnique({ where: { personId } });
  if (existing && existing.status !== 'REQUESTED' && existing.status !== 'CANCELLED') {
    return res.status(409).json({ error: 'Your request is already being handled. Message us to change it.', code: 'LOCKED' });
  }
  const data = {
    nameOnCertificate: d.name,
    language: d.language,
    delivery: d.delivery,
    contactPhone: d.delivery === 'EMAIL' ? null : phone,
    address: d.delivery === 'POST' ? d.address! : null,
    status: 'REQUESTED' as const,
    booksPassed: eligibility.passed,
  };
  const row = await prisma.certificateRequest.upsert({
    where: { personId },
    create: { personId, ...data },
    update: { ...data, requestedAt: new Date() },
  });
  if (!existing || existing.status === 'CANCELLED') {
    const person = await prisma.person.findUnique({ where: { id: personId }, select: { id: true, name: true } });
    if (person) await notifyCertificateRequested(person).catch(() => {});
  }
  res.status(existing ? 200 : 201).json({ request: studentView(row) });
}));

export default router;
