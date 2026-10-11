import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireMember } from '../lib/memberAuth';
import { requireCsrf } from '../lib/csrf';
import { asyncHandler } from '../lib/asyncHandler';
import { profilePhotoPath } from '../lib/profilePhoto';
import { socialMutationLimiter } from '../lib/rateLimit';

// ---------------------------------------------------------------------------
// /api/member — a Member's own Representation Requests ("I want to request
// to represent <free-text label>") and the public Leadership Directory of
// approved ones. See RepresentationRequest model comment in schema.prisma
// for the deliberately lightweight design (no Geography/Community tie-in).
// ---------------------------------------------------------------------------

const router = Router();

const createSchema = z.object({
  label: z.string().trim().min(2).max(120),
  note: z.string().trim().max(500).optional(),
});

// GET /api/member/representation-requests/mine — the signed-in member's own
// request history, newest first.
router.get('/representation-requests/mine', requireMember, asyncHandler(async (req, res) => {
  const items = await prisma.representationRequest.findMany({
    where: { personId: req.member!.personId },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ items });
}));

// POST /api/member/representation-requests — submit a new request. Only one
// PENDING request per person at a time.
router.post('/representation-requests', socialMutationLimiter, requireCsrf, requireMember, asyncHandler(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Please enter what you want to represent (2-120 characters).' });

  const me = req.member!.personId;
  const existingPending = await prisma.representationRequest.findFirst({ where: { personId: me, status: 'PENDING' } });
  if (existingPending) return res.status(409).json({ error: 'You already have a pending request.' });

  const created = await prisma.representationRequest.create({
    data: { personId: me, label: parsed.data.label, note: parsed.data.note || null },
  });
  res.status(201).json(created);
}));

// DELETE /api/member/representation-requests/:id — withdraw a request while
// it's still pending.
router.delete('/representation-requests/:id', socialMutationLimiter, requireCsrf, requireMember, asyncHandler(async (req, res) => {
  const result = await prisma.representationRequest.deleteMany({
    where: { id: req.params.id, personId: req.member!.personId, status: 'PENDING' },
  });
  if (result.count === 0) return res.status(404).json({ error: 'Not found.' });
  res.json({ ok: true });
}));

// GET /api/member/leadership-directory — every approved representation,
// newest-decided first. Deliberately light: id/name/photo + label only.
router.get('/leadership-directory', requireMember, asyncHandler(async (req, res) => {
  const items = await prisma.representationRequest.findMany({
    where: { status: 'APPROVED' },
    include: { person: { select: { id: true, name: true, photoStorageKey: true, photoUpdatedAt: true } } },
    orderBy: { decidedAt: 'desc' },
    take: 100,
  });
  res.json({
    items: items.map((r) => ({
      personId: r.person.id,
      name: r.person.name,
      photoUrl: profilePhotoPath(r.person),
      label: r.label,
    })),
  });
}));

export default router;
